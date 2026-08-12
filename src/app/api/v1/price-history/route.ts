/**
 * API Route: GET /api/v1/price-history
 *
 * Daily price snapshots for one product.
 *
 * These are recorded observations, one per finish per day — not a reconstruction.
 * History begins when we began tracking the product, so a recently added card
 * legitimately returns few points.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, eq, gte } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.valid) return apiError(auth.error, auth.status, auth.retryAfter);

  const params = request.nextUrl.searchParams;
  const productId = params.get('product_id') ?? params.get('card_id');
  const finish = params.get('finish');
  const days = Math.min(730, Math.max(1, parseInt(params.get('days') || '90')));

  if (!productId) return apiError('product_id is required');

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const filters = [
      eq(schema.tcgPrices.productId, parseInt(productId, 10)),
      gte(schema.tcgPrices.asOf, since),
    ];
    if (finish) filters.push(eq(schema.tcgPrices.subType, finish));

    const rows = await db
      .select()
      .from(schema.tcgPrices)
      .where(and(...filters))
      .orderBy(asc(schema.tcgPrices.asOf));

    return apiSuccess({
      product_id: productId,
      days,
      history: rows.map((r) => ({
        date: r.asOf,
        finish: r.subType,
        market_price: r.marketPrice,
        low_price: r.lowPrice,
        mid_price: r.midPrice,
        high_price: r.highPrice,
      })),
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    return apiError('Internal server error', 500);
  }
}
