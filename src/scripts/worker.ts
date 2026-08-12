/**
 * Long-running ingest worker.
 *
 * Bulk scraping does not fit Vercel: a function caps at 60s, and one pass over
 * 58k cards takes ~18 hours at PriceCharting's tolerated request rate. It also
 * should not depend on a laptop staying awake. This entrypoint is meant for a
 * small always-on box (Railway, Fly, a VPS, a systemd unit).
 *
 * It runs a tiered refresh forever:
 *
 *   fill      — cards that have no price at all, highest scrape_priority first
 *   refresh   — priced cards whose data is older than --refresh-days
 *
 * "Fill" wins until coverage exists, then the loop settles into refreshing.
 * Each cycle scrapes a bounded slice and then reprices, so the worker can be
 * killed at any point without leaving partial state — every step is an upsert
 * or an idempotent recompute.
 *
 * Usage:
 *   npx tsx src/scripts/worker.ts
 *   npx tsx src/scripts/worker.ts --batch 400 --refresh-days 7 --once
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { scrapePriceChartingCard } from '../lib/pc-scraper';

const args = process.argv.slice(2);
const argValue = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const BATCH = argValue('batch') ? parseInt(argValue('batch')!, 10) : 300;
/**
 * Deliberately conservative defaults.
 *
 * Running 3 workers at a 1.1s gap — about 0.9 req/s sustained — got us put
 * behind Cloudflare's bot challenge after roughly 11,500 requests in one day.
 * PriceCharting is a competitor doing us no favours; the goal is a trickle that
 * never trips anything, not maximum throughput.
 *
 * This is affordable now because PriceCharting is no longer the main source.
 * TCGdex covers ungraded pricing for the whole catalogue in ~8 minutes, so all
 * that is needed here is GRADED data for the cards where it matters.
 */
const CONCURRENCY = argValue('concurrency') ? parseInt(argValue('concurrency')!, 10) : 2;
const GAP_MS = argValue('gap') ? parseInt(argValue('gap')!, 10) : 3000;
const REFRESH_DAYS = argValue('refresh-days') ? parseInt(argValue('refresh-days')!, 10) : 14;
/**
 * Hard ceiling on requests per 24h. At the default 3s gap the rate limiter
 * alone caps us near 28,800/day; this is the belt to that braces.
 */
const DAILY_CAP = argValue('daily-cap') ? parseInt(argValue('daily-cap')!, 10) : 5000;
/** Pause between cycles, so a fully-caught-up worker idles cheaply. */
const IDLE_SLEEP_MS = 5 * 60 * 1000;
const RUN_ONCE = args.includes('--once');

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1); // second signal: give up immediately
    console.log(`\n[worker] ${signal} received — finishing current batch then exiting`);
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Global rate limiter (shared across workers) ---------------------------

let nextSlot = 0;
async function rateLimit() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + GAP_MS;
  if (slot > now) await sleep(slot - now);
}

// --- Work selection --------------------------------------------------------

type Mode = 'fill' | 'refresh';

interface WorkCard {
  id: number;
  name: string;
  variant: string;
  cardNumber: string | null;
  setName: string;
}

async function selectWork(mode: Mode): Promise<WorkCard[]> {
  const filters = [
    eq(schema.cards.isActive, true),
    // Cards deprioritised below zero are ones PriceCharting does not carry
    // (basic energies, reverse-holo variants they don't split, name
    // mismatches). Re-requesting them just burns the rate limit.
    sql`${schema.cards.scrapePreiority} >= 0`,
  ];

  if (mode === 'fill') {
    filters.push(
      sql`NOT EXISTS (SELECT 1 FROM current_prices cp WHERE cp.card_id = ${schema.cards.id})`
    );
  } else {
    filters.push(
      or(
        isNull(schema.cards.lastScrapedAt),
        lt(schema.cards.lastScrapedAt, new Date(Date.now() - REFRESH_DAYS * 86_400_000))
      )!
    );
  }

  return db
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
    .orderBy(
      desc(schema.cards.scrapePreiority),
      sql`${schema.cards.lastScrapedAt} ASC NULLS FIRST`,
      asc(schema.cards.id)
    )
    .limit(BATCH);
}

// --- One cycle -------------------------------------------------------------

async function runCycle(): Promise<{
  mode: Mode;
  processed: number;
  sales: number;
  /** True when the host started refusing us and the cycle aborted early. */
  blocked: boolean;
}> {
  let mode: Mode = 'fill';
  let queue = await selectWork("fill");

  if (queue.length === 0) {
    mode = 'refresh';
    queue = await selectWork('refresh');
  }

  if (queue.length === 0) return { mode, processed: 0, sales: 0, blocked: false };

  // Never exceed the day's budget, however large the batch.
  const budget = budgetRemaining();
  if (budget <= 0) return { mode, processed: 0, sales: 0, blocked: false };
  if (queue.length > budget) queue = queue.slice(0, budget);

  let processed = 0;
  let sales = 0;
  let cursor = 0;
  const scraped: number[] = [];
  const misses: number[] = [];

  /**
   * Circuit breaker.
   *
   * PriceCharting put us behind Cloudflare's bot challenge, at which point
   * every request returns 403 "Just a moment...". Without this the worker
   * would walk the entire queue burning hours to record nothing but failures,
   * and would keep hammering a host that has already said no. Consecutive
   * blocks abort the cycle; a single success resets the count.
   */
  let consecutiveBlocks = 0;
  const BLOCK_THRESHOLD = 25;
  let circuitOpen = false;

  const worker = async () => {
    while (cursor < queue.length && !stopping && !circuitOpen) {
      const card = queue[cursor++];
      await rateLimit();

      // Every request counts against the budget, whatever it returns — a 404
      // or a redirect costs the host just as much as a hit.
      spentToday++;

      try {
        const result = await scrapePriceChartingCard(db, card);
        processed++;

        if (result.success) {
          consecutiveBlocks = 0;
          sales += result.salesInserted;
          scraped.push(card.id);
        } else if (result.error?.includes('redirected to search')) {
          consecutiveBlocks = 0;
          misses.push(card.id);
        } else if (/HTTP 40[133]|Just a moment/i.test(result.error ?? '')) {
          // Blocked, not broken. Do NOT deprioritise these cards — they are
          // fine, we are the problem as far as the host is concerned.
          if (++consecutiveBlocks >= BLOCK_THRESHOLD) circuitOpen = true;
        }
      } catch {
        processed++; // transient; the card stays eligible next cycle
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  for (let i = 0; i < scraped.length; i += 500) {
    await sqlClient.query(`UPDATE cards SET last_scraped_at = now() WHERE id = ANY($1::int[])`, [
      scraped.slice(i, i + 500),
    ]);
  }
  for (let i = 0; i < misses.length; i += 500) {
    await sqlClient.query(
      `UPDATE cards SET scrape_priority = scrape_priority - 200, last_scraped_at = now()
       WHERE id = ANY($1::int[])`,
      [misses.slice(i, i + 500)]
    );
  }

  return { mode, processed, sales, blocked: circuitOpen };
}

// --- Main loop -------------------------------------------------------------

/** Requests spent in the current 24h window. */
let spentToday = 0;
let windowStartedAt = Date.now();

function budgetRemaining(): number {
  if (Date.now() - windowStartedAt > 86_400_000) {
    spentToday = 0;
    windowStartedAt = Date.now();
  }
  return DAILY_CAP - spentToday;
}

async function main() {
  console.log('=== TCGiant ingest worker ===');
  console.log(`  batch ${BATCH} · concurrency ${CONCURRENCY} · gap ${GAP_MS}ms · refresh after ${REFRESH_DAYS}d`);
  console.log(`  daily cap ${DAILY_CAP.toLocaleString()} requests`);
  console.log('  Source: PriceCharting, for GRADED prices only.');
  console.log('  Ungraded pricing comes from TCGdex — see sync-reference-prices.ts.');
  console.log('  Pricing is NOT run here; use reprocess-sales.ts --phase=2.\n');

  /** Backoff after being blocked, doubling up to a cap. */
  let blockedBackoffMs = 30 * 60 * 1000;

  for (let cycle = 1; !stopping; cycle++) {
    const started = Date.now();
    const { mode, processed, sales, blocked } = await runCycle();
    const mins = (Date.now() - started) / 60000;

    if (blocked) {
      const waitMins = blockedBackoffMs / 60000;
      console.log(
        `[cycle ${cycle}] BLOCKED by PriceCharting (Cloudflare challenge). ` +
          `Backing off ${waitMins}m. Ungraded pricing is unaffected — ` +
          `sync-reference-prices.ts uses TCGdex and does not touch this host.`
      );
      if (RUN_ONCE) break;
      await sleep(blockedBackoffMs);
      blockedBackoffMs = Math.min(blockedBackoffMs * 2, 6 * 60 * 60 * 1000);
      continue;
    }
    blockedBackoffMs = 30 * 60 * 1000;

    if (processed === 0) {
      console.log(`[cycle ${cycle}] nothing due — sleeping ${IDLE_SLEEP_MS / 60000}m`);
      if (RUN_ONCE || stopping) break;
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    console.log(
      `[cycle ${cycle}] ${mode}: ${processed} cards, +${sales.toLocaleString()} sales in ${mins.toFixed(1)}m`
    );

    if (RUN_ONCE) break;
  }

  console.log('[worker] stopped cleanly');
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
