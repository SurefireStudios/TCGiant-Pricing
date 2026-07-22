/**
 * API Route: GET /api/v1/cards
 *
 * Search and list cards with pagination.
 *
 * Parameters:
 * - q: Search query (card name)
 * - set: Filter by set slug
 * - game: Filter by game slug (default: pokemon)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 20, max: 100)
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, ilike, sql, and } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const setSlug = url.searchParams.get('set');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
  const offset = (page - 1) * limit;

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Build conditions
    const conditions = [];
    if (q) {
      conditions.push(ilike(schema.cards.name, `%${q}%`));
    }
    if (setSlug) {
      conditions.push(eq(schema.sets.slug, setSlug));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const cards = await db
      .select({
        id: schema.cards.id,
        name: schema.cards.name,
        slug: schema.cards.slug,
        cardNumber: schema.cards.cardNumber,
        rarity: schema.cards.rarity,
        imageUrl: schema.cards.imageUrl,
        setName: schema.sets.name,
        setSlug: schema.sets.slug,
      })
      .from(schema.cards)
      .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    // Get total count
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.cards)
      .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .where(whereClause);

    const countResult = await countQuery;
    const total = Number(countResult[0]?.count || 0);

    return apiSuccess({
      products: cards.map((c) => ({
        id: c.id.toString(),
        name: c.name,
        slug: c.slug,
        card_number: c.cardNumber,
        rarity: c.rarity,
        image_url: c.imageUrl,
        set_name: c.setName,
        set_slug: c.setSlug,
      })),
      page,
      limit,
      total,
      query: q || undefined,
      set: setSlug || undefined,
    });
  } catch (error) {
    console.error('Error searching cards:', error);
    return apiError('Internal server error', 500);
  }
}
