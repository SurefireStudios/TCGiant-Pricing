/**
 * Catalogue + price sync from tcgcsv.com. Multi-game.
 *
 * One job replaces the whole previous ingestion story: it fills the catalogue
 * (games, sets, cards) AND today's prices, for every enabled game, in a few
 * thousand bulk requests.
 *
 * Design points that differ from what came before:
 *   - Identity comes from the source (groupId / productId / subTypeName)
 *     instead of being reconstructed from names and slugs.
 *   - Prices are appended as dated snapshots and never rewritten, so the price
 *     history is a record rather than a reconstruction.
 *   - tcg_latest_prices has exactly one writer — this script — so it cannot
 *     drift from its own source data.
 *
 * Usage:
 *   npx tsx src/scripts/sync-catalogue.ts --enable 3,71,68     # pick games
 *   npx tsx src/scripts/sync-catalogue.ts --dry-run
 *   npx tsx src/scripts/sync-catalogue.ts                      # sync enabled
 *   npx tsx src/scripts/sync-catalogue.ts --stale-hours 20     # daily refresh
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  extended,
  fetchCategories,
  fetchGroups,
  fetchPrices,
  fetchProducts,
  slugify,
  toCents,
} from '../lib/sources/tcgcsv';

const args = process.argv.slice(2);
const argValue = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};

const DRY_RUN = args.includes('--dry-run');
const ENABLE = argValue('enable');
const CONCURRENCY = argValue('concurrency') ? parseInt(argValue('concurrency')!, 10) : 6;
const STALE_HOURS = argValue('stale-hours') ? parseInt(argValue('stale-hours')!, 10) : null;
const CHUNK = 500;

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

const today = new Date().toISOString().slice(0, 10);

async function syncCategories() {
  const cats = await fetchCategories();
  const rows = cats.map((c) => ({
    id: c.categoryId,
    name: c.name,
    slug: slugify(c.name),
    isEnabled: false,
    sortOrder: 0,
    updatedAt: new Date(),
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(schema.tcgCategories)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: schema.tcgCategories.id,
        // isEnabled is an operator decision, never overwritten by a sync.
        set: { name: sql`excluded.name`, slug: sql`excluded.slug`, updatedAt: new Date() },
      });
  }
  return rows.length;
}

async function enableGames(ids: number[]) {
  await db
    .update(schema.tcgCategories)
    .set({ isEnabled: true })
    .where(inArray(schema.tcgCategories.id, ids));
}

interface GroupRef {
  id: number;
  categoryId: number;
  name: string;
  categorySlug: string;
}

async function syncGroupsFor(categoryId: number, categorySlug: string): Promise<GroupRef[]> {
  const groups = await fetchGroups(categoryId);
  if (groups.length === 0) return [];

  const rows = groups.map((g) => ({
    id: g.groupId,
    categoryId,
    name: g.name,
    // Namespaced by game so "Base Set" in two games cannot collide.
    slug: `${categorySlug}-${slugify(g.name)}`,
    abbreviation: g.abbreviation ?? null,
    publishedOn: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
    updatedAt: new Date(),
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(schema.tcgGroups)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: schema.tcgGroups.id,
        set: {
          name: sql`excluded.name`,
          slug: sql`excluded.slug`,
          abbreviation: sql`excluded.abbreviation`,
          publishedOn: sql`excluded.published_on`,
          updatedAt: new Date(),
        },
      });
  }

  return rows.map((r) => ({ id: r.id, categoryId, name: r.name, categorySlug }));
}

interface GroupResult {
  products: number;
  prices: number;
}

async function syncGroup(group: GroupRef): Promise<GroupResult> {
  const [products, prices] = await Promise.all([
    fetchProducts(group.categoryId, group.id),
    fetchPrices(group.categoryId, group.id),
  ]);

  if (products.length > 0 && !DRY_RUN) {
    const rows = products.map((p) => {
      const number = extended(p, 'Number');
      return {
        id: p.productId,
        groupId: group.id,
        categoryId: group.categoryId,
        name: p.name,
        cleanName: p.cleanName ?? null,
        // productId keeps the slug unique without any guessing.
        slug: `${group.categorySlug}-${slugify(p.cleanName ?? p.name)}-${p.productId}`,
        number,
        rarity: extended(p, 'Rarity'),
        imageUrl: p.imageUrl ?? null,
        sourceUrl: p.url ?? null,
        updatedAt: new Date(),
      };
    });

    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(schema.tcgProducts)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: schema.tcgProducts.id,
          set: {
            name: sql`excluded.name`,
            cleanName: sql`excluded.clean_name`,
            slug: sql`excluded.slug`,
            number: sql`excluded.number`,
            rarity: sql`excluded.rarity`,
            imageUrl: sql`excluded.image_url`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: new Date(),
          },
        });
    }
  }

  // Only price products we actually stored, or the FK will reject the batch.
  const known = new Set(products.map((p) => p.productId));
  const priceRows = prices
    .filter((p) => known.has(p.productId) && p.marketPrice !== null)
    .map((p) => ({
      productId: p.productId,
      subType: p.subTypeName || 'Normal',
      asOf: today,
      marketPrice: toCents(p.marketPrice),
      lowPrice: toCents(p.lowPrice),
      midPrice: toCents(p.midPrice),
      highPrice: toCents(p.highPrice),
      directLowPrice: toCents(p.directLowPrice),
    }));

  if (priceRows.length > 0 && !DRY_RUN) {
    for (let i = 0; i < priceRows.length; i += CHUNK) {
      const batch = priceRows.slice(i, i + CHUNK);
      // A re-run on the same day corrects that day's figure rather than
      // duplicating it; earlier days are never touched.
      await db
        .insert(schema.tcgPrices)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.tcgPrices.productId, schema.tcgPrices.subType, schema.tcgPrices.asOf],
          set: {
            marketPrice: sql`excluded.market_price`,
            lowPrice: sql`excluded.low_price`,
            midPrice: sql`excluded.mid_price`,
            highPrice: sql`excluded.high_price`,
            directLowPrice: sql`excluded.direct_low_price`,
          },
        });

      await db
        .insert(schema.tcgLatestPrices)
        .values(
          batch.map((b) => ({
            productId: b.productId,
            subType: b.subType,
            asOf: b.asOf,
            marketPrice: b.marketPrice,
            lowPrice: b.lowPrice,
            midPrice: b.midPrice,
            highPrice: b.highPrice,
            updatedAt: new Date(),
          }))
        )
        .onConflictDoUpdate({
          target: [schema.tcgLatestPrices.productId, schema.tcgLatestPrices.subType],
          set: {
            asOf: sql`excluded.as_of`,
            marketPrice: sql`excluded.market_price`,
            lowPrice: sql`excluded.low_price`,
            midPrice: sql`excluded.mid_price`,
            highPrice: sql`excluded.high_price`,
            updatedAt: new Date(),
          },
        });
    }
  }

  if (!DRY_RUN) {
    await db
      .update(schema.tcgGroups)
      .set({ syncedAt: new Date() })
      .where(eq(schema.tcgGroups.id, group.id));
  }

  return { products: products.length, prices: priceRows.length };
}

async function main() {
  const started = Date.now();
  console.log('=== Catalogue sync (tcgcsv / TCGplayer) ===');
  console.log(DRY_RUN ? 'MODE: dry run' : 'MODE: apply');

  const catCount = DRY_RUN ? 0 : await syncCategories();
  if (!DRY_RUN) console.log(`  ${catCount} categories known`);

  if (ENABLE) {
    const ids = ENABLE.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
    if (!DRY_RUN) await enableGames(ids);
    console.log(`  enabled games: ${ids.join(', ')}`);
  }

  const enabled = await db
    .select()
    .from(schema.tcgCategories)
    .where(eq(schema.tcgCategories.isEnabled, true));

  if (enabled.length === 0) {
    console.log('\n  No games enabled. Pick some:');
    console.log('    npx tsx src/scripts/sync-catalogue.ts --enable 3,71,68,2');
    console.log('    (3 Pokemon · 71 Lorcana · 68 One Piece · 2 YuGiOh · 85 Pokemon Japan)');
    return;
  }

  console.log(`\n  Games: ${enabled.map((e) => `${e.name}(${e.id})`).join(', ')}\n`);

  let queue: GroupRef[] = [];
  for (const cat of enabled) {
    const groups = await syncGroupsFor(cat.id, cat.slug);
    queue.push(...groups);
    console.log(`  ${cat.name.padEnd(20)} ${groups.length} sets`);
  }

  if (STALE_HOURS !== null && !DRY_RUN) {
    const fresh = await db
      .select({ id: schema.tcgGroups.id })
      .from(schema.tcgGroups)
      .where(sql`${schema.tcgGroups.syncedAt} > now() - (${STALE_HOURS} || ' hours')::interval`);
    const skip = new Set(fresh.map((f) => f.id));
    const before = queue.length;
    queue = queue.filter((g) => !skip.has(g.id));
    console.log(`\n  skipping ${before - queue.length} sets synced in the last ${STALE_HOURS}h`);
  }

  console.log(`\n  ${queue.length} sets to sync\n`);

  let done = 0;
  let products = 0;
  let prices = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const group = queue[cursor++];
      if (!group) return;
      try {
        const r = await syncGroup(group);
        products += r.products;
        prices += r.prices;
      } catch (err) {
        failed++;
        if (failed <= 5) console.log(`\n  ! ${group.name}: ${(err as Error).message}`);
      }
      done++;
      if (done % 10 === 0) {
        const secs = (Date.now() - started) / 1000;
        process.stdout.write(
          `\r  ${done}/${queue.length} sets · ${products.toLocaleString()} products · ` +
            `${prices.toLocaleString()} prices · ${(done / secs).toFixed(1)} sets/s · ` +
            `eta ${(((queue.length - done) / Math.max(done / secs, 0.01)) / 60).toFixed(0)}m   `
        );
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const mins = (Date.now() - started) / 60000;
  console.log(`\n\n  Sets synced:  ${done.toLocaleString()}`);
  console.log(`  Products:     ${products.toLocaleString()}`);
  console.log(`  Prices today: ${prices.toLocaleString()}`);
  console.log(`  Failed sets:  ${failed}`);
  console.log(`  Duration:     ${mins.toFixed(1)}m`);
  if (DRY_RUN) console.log('\n  [dry run] nothing written');
}

main().catch((err) => {
  console.error('\nSync failed:', err);
  process.exit(1);
});
