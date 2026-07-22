/**
 * API Route: GET /api/v1/price-history
 *
 * Get price history snapshots for a card.
 *
 * Parameters:
 * - card_id: Card ID (required)
 * - condition: Filter by condition (default: UNGRADED)
 * - days: Number of days of history (default: 90, max: 730)
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, gte, desc } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  const url = new URL(request.url);
  const cardId = url.searchParams.get('card_id');
  const condition = url.searchParams.get('condition') || 'UNGRADED';
  const days = Math.min(730, Math.max(1, parseInt(url.searchParams.get('days') || '90')));

  if (!cardId) {
    return apiError('card_id parameter is required');
  }

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const snapshots = await db
      .select()
      .from(schema.priceSnapshots)
      .where(
        and(
          eq(schema.priceSnapshots.cardId, parseInt(cardId)),
          eq(schema.priceSnapshots.condition, condition as typeof schema.cardConditionEnum.enumValues[number]),
          gte(schema.priceSnapshots.snapshotDate, startDateStr)
        )
      )
      .orderBy(desc(schema.priceSnapshots.snapshotDate));

    return apiSuccess({
      card_id: cardId,
      condition,
      days,
      history: snapshots.map((s) => ({
        date: s.snapshotDate,
        market_price: s.marketPrice,
        average_price: s.averagePrice,
        median_price: s.medianPrice,
        min_price: s.minPrice,
        max_price: s.maxPrice,
        sale_count: s.saleCount,
      })),
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    return apiError('Internal server error', 500);
  }
}
