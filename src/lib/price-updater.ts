/**
 * Price Updater — Runs the pricing engine after new sales are inserted
 *
 * This module:
 * 1. Finds all card+condition combos that have new sales
 * 2. Runs the pricing engine (outlier detection, EWMA, median, etc.)
 * 3. Updates the current_prices table
 * 4. Inserts daily price_snapshots
 * 5. Marks outliers in the sales table
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { computePrice, markOutliers, type Sale as PricingSale } from './pricing-engine';
import { canonicalGradingCompany } from './grade-parser';

// --- Configuration ---

/**
 * Minimum non-outlier sales before we trust our own computed price over the
 * scraped baseline. Below this, a single odd sale can swing the number badly,
 * so the external reference is the safer thing to show.
 */
const MIN_SAMPLES_TO_TRUST = 3;

// --- Types ---

export interface PriceUpdateResult {
  cardId: number;
  condition: string;
  gradingCompany: string;
  marketPrice: number | null;
  saleCount: number;
  outlierCount: number;
}

export interface PriceUpdateStats {
  combosUpdated: number;
  pricesComputed: number;
  snapshotsCreated: number;
  outliersMarked: number;
  duration_ms: number;
}

/**
 * Update prices for all cards that had new sales inserted.
 *
 * @param cardIds - Array of card IDs that were scraped
 */
export async function updatePricesForCards(
  cardIds: number[]
): Promise<PriceUpdateStats> {
  const startTime = Date.now();

  if (!process.env.DATABASE_URL || cardIds.length === 0) {
    return {
      combosUpdated: 0,
      pricesComputed: 0,
      snapshotsCreated: 0,
      outliersMarked: 0,
      duration_ms: 0,
    };
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  const stats: PriceUpdateStats = {
    combosUpdated: 0,
    pricesComputed: 0,
    snapshotsCreated: 0,
    outliersMarked: 0,
    duration_ms: 0,
  };

  const today = new Date().toISOString().split('T')[0];

  // Get all distinct card+condition combos that have sales.
  //
  // Combos are keyed on the CANONICAL grading company, not the raw one: for
  // every condition except the 10s, a grade is a grade regardless of grader,
  // so all of a card's Grade 9 sales must feed one price. Keying on the raw
  // company split each grade into up to five thinly-sampled rows and left the
  // card page rendering whichever one came back first.
  for (const cardId of cardIds) {
    const rawCombos = await db
      .selectDistinct({
        condition: schema.sales.condition,
        gradingCompany: schema.sales.gradingCompany,
      })
      .from(schema.sales)
      .where(eq(schema.sales.cardId, cardId));

    const combos = [
      ...new Map(
        rawCombos.map((c) => {
          const canonical = canonicalGradingCompany(c.condition, c.gradingCompany);
          return [
            `${c.condition}|${canonical}`,
            { condition: c.condition, gradingCompany: canonical },
          ] as const;
        })
      ).values(),
    ];

    for (const { condition, gradingCompany } of combos) {
      try {
        // Fetch recent sales for this card+condition. For company-agnostic
        // grades we take every grader's sales; for the 10s we filter to the
        // specific company, which the condition itself already identifies.
        const isCompanySpecific = gradingCompany !== 'UNGRADED';

        const salesRows = await db
          .select({
            id: schema.sales.id,
            salePrice: schema.sales.salePrice,
            saleDate: schema.sales.saleDate,
            isOutlier: schema.sales.isOutlier,
          })
          .from(schema.sales)
          .where(
            and(
              eq(schema.sales.cardId, cardId),
              eq(schema.sales.condition, condition),
              ...(isCompanySpecific
                ? [eq(schema.sales.gradingCompany, gradingCompany)]
                : [])
            )
          )
          .orderBy(desc(schema.sales.saleDate))
          .limit(50);

        if (salesRows.length === 0) continue;

        // Convert to pricing engine format
        const pricingSales: PricingSale[] = salesRows.map((s) => ({
          id: s.id.toString(),
          price: s.salePrice,
          saleDate: new Date(s.saleDate),
        }));

        // Run outlier detection and mark in database
        const markedSales = markOutliers(pricingSales);
        let outliersInBatch = 0;

        for (let i = 0; i < markedSales.length; i++) {
          const sale = markedSales[i];
          const dbSale = salesRows[i];

          if (sale.isOutlier !== dbSale.isOutlier) {
            await db
              .update(schema.sales)
              .set({ isOutlier: sale.isOutlier || false })
              .where(eq(schema.sales.id, dbSale.id));

            if (sale.isOutlier) outliersInBatch++;
          }
        }

        stats.outliersMarked += outliersInBatch;

        // Compute the price
        const priceResult = computePrice(pricingSales);

        if (!priceResult) continue;

        stats.pricesComputed++;

        // Upsert current_prices.
        //
        // The external (PriceCharting) figure lives in `baselinePrice` and is
        // never written here — the scraper owns that column. `marketPrice` is
        // OUR number whenever we have enough samples to stand behind it, and
        // falls back to the baseline only when we don't.
        //
        // This used to read the existing marketPrice and write it straight back,
        // which pinned every price to the scraped baseline forever and made the
        // whole pricing engine a no-op.
        const existingCp = await db
          .select()
          .from(schema.currentPrices)
          .where(
            and(
              eq(schema.currentPrices.cardId, cardId),
              eq(schema.currentPrices.condition, condition as any),
              eq(schema.currentPrices.gradingCompany, gradingCompany as any)
            )
          );

        const baselinePrice = existingCp[0]?.baselinePrice ?? null;

        const haveEnoughSamples = priceResult.saleCount >= MIN_SAMPLES_TO_TRUST;

        const targetMarketPrice = haveEnoughSamples
          ? priceResult.marketPrice
          : baselinePrice ?? priceResult.marketPrice;

        const priceSource = haveEnoughSamples
          ? 'computed'
          : baselinePrice
            ? 'baseline'
            : 'computed';

        await db
          .insert(schema.currentPrices)
          .values({
            cardId,
            condition: condition as any,
            gradingCompany: gradingCompany as any,
            marketPrice: targetMarketPrice,
            medianPrice: priceResult.medianPrice,
            priceSource,
            saleCount: priceResult.saleCount,
            lastSaleDate: new Date(salesRows[0].saleDate),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.currentPrices.cardId,
              schema.currentPrices.condition,
              schema.currentPrices.gradingCompany,
            ],
            set: {
              marketPrice: targetMarketPrice,
              medianPrice: priceResult.medianPrice,
              priceSource,
              saleCount: priceResult.saleCount,
              lastSaleDate: new Date(salesRows[0].saleDate),
              updatedAt: new Date(),
            },
          });

        // Write exactly ONE snapshot, for today.
        //
        // This used to also write today's computed price into a row for every
        // historical date that had a sale — which manufactured a price history
        // that never happened. Roughly half of all card+condition series ended
        // up as a flat line at a single price, and /api/v1/price-history served
        // that fabricated series to callers.
        //
        // A snapshot is a record of what the price was on the day it was taken,
        // so it can only ever be written for today. Genuine history accumulates
        // one honest row per day from here forward; the card detail page
        // derives its chart from raw sales, which is real.
        await db
          .insert(schema.priceSnapshots)
          .values({
            cardId,
            condition,
            gradingCompany,
            marketPrice: priceResult.marketPrice,
            medianPrice: priceResult.medianPrice,
            averagePrice: priceResult.averagePrice,
            ewmaPrice: priceResult.ewmaPrice,
            minPrice: priceResult.minPrice,
            maxPrice: priceResult.maxPrice,
            saleCount: priceResult.saleCount,
            outlierCount: priceResult.outlierCount,
            period: 'daily' as const,
            snapshotDate: today,
          })
          .onConflictDoUpdate({
            target: [
              schema.priceSnapshots.cardId,
              schema.priceSnapshots.condition,
              schema.priceSnapshots.gradingCompany,
              schema.priceSnapshots.snapshotDate,
              schema.priceSnapshots.period,
            ],
            set: {
              marketPrice: priceResult.marketPrice,
              medianPrice: priceResult.medianPrice,
              averagePrice: priceResult.averagePrice,
              ewmaPrice: priceResult.ewmaPrice,
              minPrice: priceResult.minPrice,
              maxPrice: priceResult.maxPrice,
              saleCount: priceResult.saleCount,
              outlierCount: priceResult.outlierCount,
            },
          });
        stats.snapshotsCreated++;
        stats.combosUpdated++;
      } catch (err: any) {
        console.error(
          `[PRICE-UPDATER] Error updating card ${cardId} / ${condition} / ${gradingCompany}: ${err.message}`
        );
      }
    }
  }

  stats.duration_ms = Date.now() - startTime;

  return stats;
}
