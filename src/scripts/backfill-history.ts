/**
 * PriceCharting Backfill — concurrent, resumable, priority-ordered.
 *
 * Replaces the original serial loop, which processed one card at a time with a
 * fixed 1.2s sleep plus ~430 sequential Neon round trips per card (a SELECT and
 * an UPDATE/INSERT per condition, then one INSERT per sale row). A single pass
 * over 58k cards would have taken days, and it walked sets in release order, so
 * it never reached a modern set.
 *
 * What changed:
 *   - N workers pull from a shared queue, throttled by one global rate limiter.
 *   - Per-card DB work is batched into 2 statements (see lib/pc-scraper.ts).
 *   - Price computation is decoupled: it runs once per completed chunk of cards
 *     rather than once per card.
 *   - Cards are ordered by scrape_priority, so commercially important cards are
 *     reached first and a partial run is still a useful run.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-history.ts --limit 200            # try it out
 *   npx tsx src/scripts/backfill-history.ts --concurrency 12       # full run
 *   npx tsx src/scripts/backfill-history.ts --set pokemon-base-set # one set
 *   npx tsx src/scripts/backfill-history.ts --unpriced-only        # fill gaps
 *   npx tsx src/scripts/backfill-history.ts --stale-days 7         # refresh old
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { scrapePriceChartingCard } from '../lib/pc-scraper';
import { updatePricesForCards } from '../lib/price-updater';

// --- Args -------------------------------------------------------------------

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const LIMIT = argValue('limit') ? parseInt(argValue('limit')!, 10) : Infinity;
const CONCURRENCY = argValue('concurrency') ? parseInt(argValue('concurrency')!, 10) : 4;
/**
 * Minimum gap between outbound requests, across ALL workers.
 *
 * PriceCharting starts returning 429 well below 4 req/s — a 250ms gap produced
 * a 70% failure rate in testing. 750ms (~1.3 req/s) runs clean. The scraper
 * also backs off and retries on 429, so this is the steady-state rate, not a
 * hard ceiling.
 */
const MIN_REQUEST_GAP_MS = argValue('gap') ? parseInt(argValue('gap')!, 10) : 750;
const SET_SLUG = argValue('set');
const UNPRICED_ONLY = args.includes('--unpriced-only');
const STALE_DAYS = argValue('stale-days') ? parseInt(argValue('stale-days')!, 10) : null;
/**
 * Pricing is OFF by default.
 *
 * updatePricesForCards issues a handful of sequential queries per card per
 * condition; over a batch that costs thousands of Neon round trips and
 * dominated the run (a 60-card test spent ~80% of its wall clock there while
 * the scrape itself ran at 0.9 cards/s). Scraping and pricing are independent,
 * and `reprocess-sales.ts --phase=2` prices the entire table in well under a
 * minute by grouping in memory. So: scrape here, price afterwards.
 *
 * Pass --price to restore inline pricing for small runs.
 */
const INLINE_PRICING = args.includes('--price');
/** How many cards to finish before running the pricing engine over them. */
const PRICE_CHUNK = 100;

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

// --- Global rate limiter ----------------------------------------------------

/**
 * Serialises the *start* of every outbound request across all workers.
 *
 * Concurrency alone would let N workers fire simultaneously and hammer
 * PriceCharting in bursts. This keeps a steady, polite request rate no matter
 * how many workers are running: raising --concurrency hides latency, it does
 * not increase request rate.
 */
let nextSlot = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_REQUEST_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// --- Card selection ---------------------------------------------------------

interface QueueCard {
  id: number;
  name: string;
  variant: string;
  cardNumber: string | null;
  setName: string;
}

async function selectCards(): Promise<QueueCard[]> {
  const filters = [eq(schema.cards.isActive, true)];

  if (SET_SLUG) {
    filters.push(eq(schema.sets.slug, SET_SLUG));
  }

  if (UNPRICED_ONLY) {
    // Cards with no price row at all — the fastest way to grow coverage.
    filters.push(
      sql`NOT EXISTS (SELECT 1 FROM current_prices cp WHERE cp.card_id = ${schema.cards.id})`
    );
  }

  if (STALE_DAYS !== null) {
    filters.push(
      or(
        isNull(schema.cards.lastScrapedAt),
        lt(
          schema.cards.lastScrapedAt,
          new Date(Date.now() - STALE_DAYS * 86_400_000)
        )
      )!
    );
  }

  const rows = await db
    .select({
      id: schema.cards.id,
      name: schema.cards.name,
      variant: schema.cards.variant,
      cardNumber: schema.cards.cardNumber,
      setName: schema.sets.name,
    })
    .from(schema.cards)
    .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
    .where(and(...filters))
    // Priority first, then least-recently-scraped. A run that is cut short
    // still leaves the most valuable cards done.
    .orderBy(
      desc(schema.cards.scrapePreiority),
      sql`${schema.cards.lastScrapedAt} ASC NULLS FIRST`,
      asc(schema.cards.id)
    )
    .limit(LIMIT === Infinity ? 1_000_000 : LIMIT);

  return rows;
}

// --- Main -------------------------------------------------------------------

interface Stats {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  salesInserted: number;
  pricesUpdated: number;
  /** Failure reason → count, so a bad run says what went wrong. */
  failureReasons: Map<string, number>;
  failureSamples: string[];
}

/** Collapse a raw error into a bucket worth counting. */
function classifyFailure(error: string | undefined): string {
  if (!error) return 'unknown';
  if (/HTTP 404/.test(error)) return 'HTTP 404 (no such product)';
  if (/HTTP 4\d\d/.test(error)) return error.slice(0, 40);
  if (/HTTP 5\d\d/.test(error)) return 'HTTP 5xx (PriceCharting error)';
  if (/no price table/i.test(error)) return 'redirected to search (slug miss)';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(error)) return 'network';
  if (/invalid input value for enum/i.test(error)) return 'enum mismatch';
  if (/duplicate key|unique constraint/i.test(error)) return 'duplicate key';
  return error.slice(0, 60);
}

async function main() {
  const started = Date.now();

  console.log('=== PriceCharting Backfill ===');
  console.log(`  concurrency:   ${CONCURRENCY} workers`);
  console.log(`  request gap:   ${MIN_REQUEST_GAP_MS}ms (global)`);
  if (SET_SLUG) console.log(`  set filter:    ${SET_SLUG}`);
  if (UNPRICED_ONLY) console.log('  filter:        unpriced cards only');
  if (STALE_DAYS !== null) console.log(`  filter:        not scraped in ${STALE_DAYS}d`);
  console.log(`  limit:         ${LIMIT === Infinity ? 'none' : LIMIT}`);

  const queue = await selectCards();
  console.log(`\n  ${queue.length.toLocaleString()} cards queued\n`);

  if (queue.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const stats: Stats = {
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    salesInserted: 0,
    pricesUpdated: 0,
    failureReasons: new Map(),
    failureSamples: [],
  };

  // Cards whose sales changed, awaiting a pricing pass.
  let pendingPricing: number[] = [];
  const scrapedIds: number[] = [];
  /** Cards PriceCharting appears not to carry — deprioritised at the end. */
  const slugMisses: number[] = [];

  let cursor = 0;
  const takeNext = (): QueueCard | undefined =>
    cursor < queue.length ? queue[cursor++] : undefined;

  const flushPricing = async (force = false) => {
    if (!INLINE_PRICING) return;
    if (pendingPricing.length === 0) return;
    if (!force && pendingPricing.length < PRICE_CHUNK) return;

    const batch = pendingPricing;
    pendingPricing = [];
    try {
      await updatePricesForCards(batch);
    } catch (err) {
      console.error(`\n  [pricing] batch failed: ${(err as Error).message}`);
    }
  };

  const worker = async () => {
    for (;;) {
      const card = takeNext();
      if (!card) return;

      await rateLimit();

      let result;
      try {
        result = await scrapePriceChartingCard(db, card);
      } catch (err) {
        result = {
          success: false,
          url: '',
          salesInserted: 0,
          pricesUpdated: 0,
          error: (err as Error).message,
        };
      }

      stats.processed++;

      if (result.success) {
        stats.succeeded++;
        stats.salesInserted += result.salesInserted;
        stats.pricesUpdated += result.pricesUpdated;
        scrapedIds.push(card.id);
        if (result.salesInserted > 0 || result.pricesUpdated > 0) {
          pendingPricing.push(card.id);
        }
      } else if (result.error?.startsWith('Skipped:')) {
        stats.skipped++;
      } else {
        stats.failed++;
        const reason = classifyFailure(result.error);

        // A slug miss usually means PriceCharting has no such product at all —
        // basic energies from modern sets, reverse-holo variants they don't
        // split, or a card they name differently. Retrying it every run just
        // burns the rate limit (1,399 misses in a 3,000-card run is ~23 minutes
        // of pure waste at 1 req/s), so sink it to the bottom of the queue.
        // Transient failures (429, network) are NOT penalised.
        if (reason.startsWith('redirected to search')) {
          slugMisses.push(card.id);
        }
        stats.failureReasons.set(reason, (stats.failureReasons.get(reason) ?? 0) + 1);
        if (stats.failureSamples.length < 8) {
          stats.failureSamples.push(
            `${card.setName} :: ${card.name} #${card.cardNumber ?? '-'} [${card.variant}] — ${result.error}`
          );
        }
      }

      if (stats.processed % 25 === 0) {
        const elapsed = (Date.now() - started) / 1000;
        const rate = stats.processed / elapsed;
        const remaining = (queue.length - stats.processed) / Math.max(rate, 0.001);
        process.stdout.write(
          `\r  ${stats.processed.toLocaleString()}/${queue.length.toLocaleString()} · ` +
            `${rate.toFixed(1)} cards/s · ok ${stats.succeeded.toLocaleString()} · ` +
            `skip ${stats.skipped.toLocaleString()} · fail ${stats.failed.toLocaleString()} · ` +
            `sales +${stats.salesInserted.toLocaleString()} · ` +
            `eta ${(remaining / 60).toFixed(0)}m   `
        );
      }

      // Only one worker runs the pricing flush at a time; the length check
      // makes this naturally self-limiting.
      await flushPricing();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await flushPricing(true);

  // Mark everything we actually fetched, so --stale-days works next time.
  for (let i = 0; i < scrapedIds.length; i += 500) {
    const chunk = scrapedIds.slice(i, i + 500);
    await sqlClient.query(
      `UPDATE cards SET last_scraped_at = now() WHERE id = ANY($1::int[])`,
      [chunk]
    );
  }

  // Sink cards PriceCharting does not carry, so subsequent runs spend their
  // request budget on cards that can actually resolve. Also stamp them as
  // scraped so --stale-days doesn't immediately pull them back to the front.
  for (let i = 0; i < slugMisses.length; i += 500) {
    const chunk = slugMisses.slice(i, i + 500);
    await sqlClient.query(
      `UPDATE cards
         SET scrape_priority = scrape_priority - 200,
             last_scraped_at = now()
       WHERE id = ANY($1::int[])`,
      [chunk]
    );
  }
  if (slugMisses.length > 0) {
    console.log(
      `\n  ${slugMisses.length.toLocaleString()} cards deprioritised (PriceCharting has no such product)`
    );
  }

  const elapsed = (Date.now() - started) / 1000;
  console.log(`\n\n=== Complete in ${(elapsed / 60).toFixed(1)}m ===`);
  console.log(`  Cards processed:  ${stats.processed.toLocaleString()}`);
  console.log(`    succeeded:      ${stats.succeeded.toLocaleString()}`);
  console.log(`    skipped:        ${stats.skipped.toLocaleString()}`);
  console.log(`    failed:         ${stats.failed.toLocaleString()}`);
  console.log(`  Sales inserted:   ${stats.salesInserted.toLocaleString()}`);
  console.log(`  Baselines set:    ${stats.pricesUpdated.toLocaleString()}`);
  console.log(`  Throughput:       ${(stats.processed / elapsed).toFixed(1)} cards/s`);

  if (stats.failureReasons.size > 0) {
    console.log('\n  Failure reasons:');
    for (const [reason, count] of [...stats.failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(6)}  ${reason}`);
    }
    console.log('\n  Samples:');
    for (const s of stats.failureSamples) console.log(`    - ${s}`);
  }

  if (!INLINE_PRICING && stats.salesInserted > 0) {
    console.log('\n  Sales are in, but prices have NOT been recomputed. Next:');
    console.log('    npx tsx src/scripts/reprocess-sales.ts --phase=2');
  }
}

main().catch((err) => {
  console.error('\nBackfill failed:', err);
  process.exit(1);
});
