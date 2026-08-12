/**
 * Sync TCGplayer / Cardmarket reference prices from TCGdex.
 *
 * Free, no API key, no quota. Card-by-card because TCGdex has no bulk endpoint
 * that includes prices, but at ~115ms per card that is still far quicker than
 * anything else available: the whole catalogue lands in well under an hour with
 * a handful of workers, versus ~18 hours for a PriceCharting pass.
 *
 * Every price lands under condition UNGRADED — these are raw-card marketplace
 * prices. Graded pricing still comes from PriceCharting.
 *
 * Usage:
 *   npx tsx src/scripts/sync-reference-prices.ts --dry-run --limit 50
 *   npx tsx src/scripts/sync-reference-prices.ts --concurrency 8
 *   npx tsx src/scripts/sync-reference-prices.ts --stale-hours 20   # daily refresh
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  extractCardmarketPrice,
  extractTcgplayerPrice,
  fetchCard,
  type ReferencePrice,
} from '../lib/sources/tcgdex';
import type { CardVariant } from '../lib/grade-parser';

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

const DRY_RUN = args.includes('--dry-run');
const LIMIT = argValue('limit') ? parseInt(argValue('limit')!, 10) : Infinity;
const CONCURRENCY = argValue('concurrency') ? parseInt(argValue('concurrency')!, 10) : 8;
/** Only refresh references older than this. Omit to do everything. */
const STALE_HOURS = argValue('stale-hours') ? parseInt(argValue('stale-hours')!, 10) : null;
const INCLUDE_CARDMARKET = !args.includes('--no-cardmarket');
const WRITE_BATCH = 500;

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

/**
 * TCGdex card ids are `<setId>-<localId>`, where localId is the printed card
 * number with leading zeros stripped ("004" is served as `base1-4`).
 * Letter-prefixed numbers such as TG30 are kept verbatim.
 */
function buildTcgdexId(tcgdexSetId: string | undefined, cardNumber: string | null): string | null {
  if (!tcgdexSetId || !cardNumber) return null;
  const trimmed = cardNumber.trim();
  const localId = /^[0-9]+$/.test(trimmed) ? String(parseInt(trimmed, 10)) : trimmed;
  return `${tcgdexSetId}-${localId}`;
}

async function main() {
  console.log('=== Reference price sync (TCGdex) ===');
  console.log(DRY_RUN ? 'MODE: dry run' : 'MODE: apply');
  console.log(`  concurrency ${CONCURRENCY}${STALE_HOURS ? ` · refreshing rows older than ${STALE_HOURS}h` : ''}`);

  const filters = [eq(schema.cards.isActive, true), isNotNull(schema.cards.cardNumber)];

  if (STALE_HOURS !== null) {
    // A card is due when it has no tcgplayer reference, or that reference is old.
    filters.push(
      sql`NOT EXISTS (
        SELECT 1 FROM price_references r
        WHERE r.card_id = ${schema.cards.id}
          AND r.source = 'tcgplayer'
          AND r.updated_at > now() - (${STALE_HOURS} || ' hours')::interval
      )`
    );
  }

  // Map our sets onto TCGdex's.
  //
  // Our `externalId` comes from pokemontcg.io and mostly matches TCGdex's set
  // ids, but not always — 122 of 173 English sets match by id, and another 50
  // only match by name. Relying on the card-level externalId alone found just
  // 34 of 300 cards; going via the set and rebuilding the card id from the card
  // number covers 39,286 of 39,291 English cards.
  const tcgdexSets = (await (
    await fetch('https://api.tcgdex.net/v2/en/sets', { headers: { Accept: 'application/json' } })
  ).json()) as { id: string; name: string }[];

  const normName = (s: string) =>
    s.toLowerCase().replace(/\s*\(japanese\)\s*/i, '').replace(/[^a-z0-9]/g, '');
  const tcgdexById = new Map(tcgdexSets.map((s) => [s.id, s.id]));
  const tcgdexByName = new Map(tcgdexSets.map((s) => [normName(s.name), s.id]));

  const ourSets = await db
    .select({ id: schema.sets.id, name: schema.sets.name, externalId: schema.sets.externalId })
    .from(schema.sets);

  const setIdToTcgdex = new Map<number, string>();
  for (const s of ourSets) {
    // TCGdex's English API has no Japanese sets; skip rather than 404 on each card.
    if (/\(japanese\)/i.test(s.name)) continue;
    const match =
      (s.externalId ? tcgdexById.get(s.externalId) : undefined) ?? tcgdexByName.get(normName(s.name));
    if (match) setIdToTcgdex.set(s.id, match);
  }
  console.log(`  ${setIdToTcgdex.size} of ${ourSets.length} sets mapped to TCGdex`);

  const cards = (
    await db
      .select({
        id: schema.cards.id,
        setId: schema.cards.setId,
        cardNumber: schema.cards.cardNumber,
        variant: schema.cards.variant,
        rarity: schema.cards.rarity,
        name: schema.cards.name,
      })
      .from(schema.cards)
      .where(and(...filters))
      .orderBy(desc(schema.cards.scrapePreiority), asc(schema.cards.id))
      .limit(LIMIT === Infinity ? 1_000_000 : LIMIT)
  )
    .map((c) => ({ ...c, externalId: buildTcgdexId(setIdToTcgdex.get(c.setId), c.cardNumber) }))
    .filter((c): c is typeof c & { externalId: string } => c.externalId !== null);

  console.log(`\n  ${cards.length.toLocaleString()} cards due\n`);
  if (cards.length === 0) {
    console.log('  Nothing to do.');
    return;
  }

  // One TCGdex card serves every variant row we hold for it, so fetch once.
  const byExternal = new Map<string, typeof cards>();
  for (const c of cards) {
    const list = byExternal.get(c.externalId!) ?? [];
    list.push(c);
    byExternal.set(c.externalId!, list);
  }
  const externalIds = [...byExternal.keys()];
  console.log(`  ${externalIds.length.toLocaleString()} distinct TCGdex ids to fetch\n`);

  const started = Date.now();
  let fetched = 0;
  let absent = 0;
  let failed = 0;
  let refs = 0;
  let pending: (typeof schema.priceReferences.$inferInsert)[] = [];

  const flush = async (force = false) => {
    if (DRY_RUN) { pending = []; return; }
    if (pending.length === 0 || (!force && pending.length < WRITE_BATCH)) return;
    const batch = pending;
    pending = [];
    await db
      .insert(schema.priceReferences)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          schema.priceReferences.cardId,
          schema.priceReferences.condition,
          schema.priceReferences.source,
        ],
        set: {
          price: sql`excluded.price`,
          lowPrice: sql`excluded.low_price`,
          midPrice: sql`excluded.mid_price`,
          highPrice: sql`excluded.high_price`,
          currency: sql`excluded.currency`,
          variantKey: sql`excluded.variant_key`,
          observedAt: sql`excluded.observed_at`,
          updatedAt: new Date(),
        },
      });
  };

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const externalId = externalIds[cursor++];
      if (externalId === undefined) return;

      let remote;
      try {
        remote = await fetchCard(externalId);
      } catch {
        failed++;
        continue;
      }

      fetched++;
      if (!remote) { absent++; continue; }

      for (const card of byExternal.get(externalId)!) {
        const variant = card.variant as CardVariant;
        const found: (ReferencePrice | null)[] = [
          extractTcgplayerPrice(remote, variant, card.rarity),
          INCLUDE_CARDMARKET ? extractCardmarketPrice(remote, variant) : null,
        ];

        for (const ref of found) {
          if (!ref) continue;
          refs++;
          pending.push({
            cardId: card.id,
            condition: 'UNGRADED',
            source: ref.source,
            price: ref.price,
            lowPrice: ref.lowPrice,
            midPrice: ref.midPrice,
            highPrice: ref.highPrice,
            currency: ref.currency,
            variantKey: ref.variantKey,
            observedAt: ref.observedAt,
            updatedAt: new Date(),
          });
        }
      }

      await flush();

      if (fetched % 200 === 0) {
        const secs = (Date.now() - started) / 1000;
        const rate = fetched / secs;
        process.stdout.write(
          `\r  ${fetched.toLocaleString()}/${externalIds.length.toLocaleString()} · ` +
            `${rate.toFixed(1)}/s · ${refs.toLocaleString()} refs · ` +
            `${absent} absent · ${failed} failed · ` +
            `eta ${(((externalIds.length - fetched) / Math.max(rate, 0.01)) / 60).toFixed(0)}m   `
        );
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await flush(true);

  const mins = (Date.now() - started) / 60000;
  console.log(`\n\n  Fetched:     ${fetched.toLocaleString()}`);
  console.log(`  Not in TCGdex: ${absent.toLocaleString()}`);
  console.log(`  Failed:      ${failed.toLocaleString()}`);
  console.log(`  References:  ${refs.toLocaleString()}`);
  console.log(`  Duration:    ${mins.toFixed(1)}m (${(fetched / (mins * 60)).toFixed(1)}/s)`);
  if (DRY_RUN) console.log('\n  [dry run] nothing written');
}

main().catch((err) => {
  console.error('\nSync failed:', err);
  process.exit(1);
});
