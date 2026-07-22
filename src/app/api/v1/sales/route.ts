/**
 * API Route: GET /api/v1/sales
 *
 * Get recent sales for a card.
 *
 * Parameters:
 * - card_id: Card ID (required)
 * - condition: Filter by condition
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 20)
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, desc, and, sql } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  const url = new URL(request.url);
  const cardId = url.searchParams.get('card_id');
  const condition = url.searchParams.get('condition');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
  const offset = (page - 1) * limit;

  if (!cardId) {
    return apiError('card_id parameter is required');
  }

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Build conditions
    const conditions = [eq(schema.sales.cardId, parseInt(cardId))];
    if (condition) {
      conditions.push(eq(schema.sales.condition, condition as typeof schema.cardConditionEnum.enumValues[number]));
    }

    const sales = await db
      .select()
      .from(schema.sales)
      .where(and(...conditions))
      .orderBy(desc(schema.sales.saleDate))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sales)
      .where(and(...conditions));
    const total = Number(countResult[0]?.count || 0);

    return apiSuccess({
      sales: sales.map((s) => ({
        id: s.id.toString(),
        sale_price: s.salePrice,
        sale_date: s.saleDate,
        condition: s.condition,
        grading_company: s.gradingCompany,
        grade_value: s.gradeValue,
        ebay_title: s.ebayTitle,
        ebay_item_id: s.ebayItemId,
        ebay_url: s.ebayItemId
          ? `https://www.ebay.com/itm/${s.ebayItemId}`
          : null,
        is_outlier: s.isOutlier,
      })),
      page,
      limit,
      total,
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    return apiError('Internal server error', 500);
  }
}
