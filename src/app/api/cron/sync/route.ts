/**
 * API Route: GET /api/cron/sync
 *
 * Keeps the catalogue and prices current. This is the job whose absence made
 * the site nine days stale: every ingestion script existed, but nothing ever
 * ran them unattended.
 *
 * It syncs a bounded slice of the least-recently-updated sets per invocation
 * rather than the whole catalogue, so it fits comfortably inside a serverless
 * timeout and is self-healing — a failed run just leaves those sets stale and
 * the next run picks them up first. With ~320 sets and a slice of 40 every 10
 * minutes, everything refreshes several times a day.
 *
 * Protected by CRON_SECRET, and fails closed without it.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { asc, eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import {
  extended,
  fetchPrices,
  fetchProducts,
  slugify,
  toCents,
} from '@/lib/sources/tcgcsv';

export const maxDuration = 60;

/**
 * Sets per invocation.
 *
 * Measured at ~94ms per set (40 sets in 3.8s), so 120 lands around 11s —
 * comfortably inside maxDuration even if the upstream slows considerably.
 * With ~320 sets and an hourly schedule, the whole catalogue refreshes roughly
 * every three hours.
 */
const SLICE = 120;
const CONCURRENCY = 6;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: 'Cron endpoint is not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

  try {
    // Least-recently-synced first, so the queue drains evenly and a set can
    // never be starved.
    const groups = await db
      .select({
        id: schema.tcgGroups.id,
        categoryId: schema.tcgGroups.categoryId,
        name: schema.tcgGroups.name,
        categorySlug: schema.tcgCategories.slug,
      })
      .from(schema.tcgGroups)
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgGroups.categoryId))
      .where(eq(schema.tcgCategories.isEnabled, true))
      .orderBy(sql`${schema.tcgGroups.syncedAt} ASC NULLS FIRST`, asc(schema.tcgGroups.id))
      .limit(SLICE);

    let products = 0;
    let prices = 0;
    let failed = 0;
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const group = groups[cursor++];
        if (!group) return;

        try {
          const [remoteProducts, remotePrices] = await Promise.all([
            fetchProducts(group.categoryId, group.id),
            fetchPrices(group.categoryId, group.id),
          ]);

          if (remoteProducts.length > 0) {
            await db
              .insert(schema.tcgProducts)
              .values(
                remoteProducts.map((p) => ({
                  id: p.productId,
                  groupId: group.id,
                  categoryId: group.categoryId,
                  name: p.name,
                  cleanName: p.cleanName ?? null,
                  slug: `${group.categorySlug}-${slugify(p.cleanName ?? p.name)}-${p.productId}`,
                  number: extended(p, 'Number'),
                  rarity: extended(p, 'Rarity'),
                  imageUrl: p.imageUrl ?? null,
                  sourceUrl: p.url ?? null,
                  updatedAt: new Date(),
                }))
              )
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
            products += remoteProducts.length;
          }

          const known = new Set(remoteProducts.map((p) => p.productId));
          const rows = remotePrices
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

          if (rows.length > 0) {
            // Today's row is corrected on re-run; earlier days are immutable.
            await db
              .insert(schema.tcgPrices)
              .values(rows)
              .onConflictDoUpdate({
                target: [
                  schema.tcgPrices.productId,
                  schema.tcgPrices.subType,
                  schema.tcgPrices.asOf,
                ],
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
                rows.map((r) => ({
                  productId: r.productId,
                  subType: r.subType,
                  asOf: r.asOf,
                  marketPrice: r.marketPrice,
                  lowPrice: r.lowPrice,
                  midPrice: r.midPrice,
                  highPrice: r.highPrice,
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
            prices += rows.length;
          }

          await db
            .update(schema.tcgGroups)
            .set({ syncedAt: new Date() })
            .where(eq(schema.tcgGroups.id, group.id));
        } catch (err) {
          // Leave syncedAt alone so this set stays at the front of the queue.
          failed++;
          console.error(`[cron/sync] ${group.name}: ${(err as Error).message}`);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Freshness, reported so it can be alerted on rather than discovered by a user.
    const [freshness] = await db
      .select({
        oldest: sql<string | null>`min(${schema.tcgGroups.syncedAt})::text`,
        newest: sql<string | null>`max(${schema.tcgGroups.syncedAt})::text`,
        neverSynced: sql<number>`count(*) filter (where ${schema.tcgGroups.syncedAt} is null)`,
      })
      .from(schema.tcgGroups);

    return Response.json({
      status: 'success',
      duration_ms: Date.now() - started,
      sets_attempted: groups.length,
      sets_failed: failed,
      products_upserted: products,
      prices_recorded: prices,
      freshness: {
        oldest_set_synced: freshness?.oldest ?? null,
        newest_set_synced: freshness?.newest ?? null,
        never_synced: Number(freshness?.neverSynced ?? 0),
      },
    });
  } catch (error) {
    console.error('[cron/sync] failed:', error);
    return Response.json(
      { status: 'error', message: (error as Error).message },
      { status: 500 }
    );
  }
}
