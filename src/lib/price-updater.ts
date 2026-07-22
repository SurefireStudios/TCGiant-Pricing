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

  // Get all distinct card+condition combos that have sales
  for (const cardId of cardIds) {
    // Get all distinct card combos that have sales
    const combos = await db
      .selectDistinct({
        condition: schema.sales.condition,
        gradingCompany: schema.sales.gradingCompany,
      })
      .from(schema.sales)
      .where(eq(schema.sales.cardId, cardId));

    for (const { condition, gradingCompany } of combos) {
      try {
        // Fetch recent sales for this card+condition
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
              eq(schema.sales.gradingCompany, gradingCompany)
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

        // Upsert current_prices
        // Check if existing marketPrice exists in currentPrices (to preserve PriceCharting baseline)
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

        const targetMarketPrice =
          existingCp.length > 0 && existingCp[0].marketPrice
            ? existingCp[0].marketPrice
            : priceResult.marketPrice;

        await db
          .insert(schema.currentPrices)
          .values({
            cardId,
            condition: condition as any,
            gradingCompany: gradingCompany as any,
            marketPrice: targetMarketPrice,
            medianPrice: priceResult.medianPrice,
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
              saleCount: priceResult.saleCount,
              lastSaleDate: new Date(salesRows[0].saleDate),
              updatedAt: new Date(),
            },
          });

        // Insert snapshots for distinct historical sale dates
        const datesToSnapshot = new Set<string>();
        datesToSnapshot.add(today);
        for (const s of salesRows) {
          const dStr = new Date(s.saleDate).toISOString().split('T')[0];
          datesToSnapshot.add(dStr);
        }

        for (const snapDate of datesToSnapshot) {
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
              snapshotDate: snapDate,
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
        }
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
