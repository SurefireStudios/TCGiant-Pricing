/**
 * API Route: GET /api/v1/cards
 *
 * Search and list products across every enabled game.
 *
 * Parameters:
 * - q: name search
 * - game: game slug (pokemon, lorcana-tcg, one-piece-card-game, …)
 * - set: set slug
 * - page, limit
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.valid) return apiError(auth.error, auth.status, auth.retryAfter);

  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const game = url.searchParams.get('game');
  const set = url.searchParams.get('set');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

    const filters = [eq(schema.tcgCategories.isEnabled, true)];
    if (q) filters.push(ilike(schema.tcgProducts.name, `%${q}%`));
    if (game) filters.push(eq(schema.tcgCategories.slug, game));
    if (set) filters.push(eq(schema.tcgGroups.slug, set));
    const where = and(...filters);

    const rows = await db
      .select({
        id: schema.tcgProducts.id,
        name: schema.tcgProducts.name,
        slug: schema.tcgProducts.slug,
        number: schema.tcgProducts.number,
        rarity: schema.tcgProducts.rarity,
        imageUrl: schema.tcgProducts.imageUrl,
        setName: schema.tcgGroups.name,
        setSlug: schema.tcgGroups.slug,
        gameName: schema.tcgCategories.name,
        gameSlug: schema.tcgCategories.slug,
      })
      .from(schema.tcgProducts)
      .innerJoin(schema.tcgGroups, eq(schema.tcgGroups.id, schema.tcgProducts.groupId))
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgProducts.categoryId))
      .where(where)
      .orderBy(asc(schema.tcgProducts.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const [count] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.tcgProducts)
      .innerJoin(schema.tcgGroups, eq(schema.tcgGroups.id, schema.tcgProducts.groupId))
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgProducts.categoryId))
      .where(where);

    return apiSuccess({
      products: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        slug: r.slug,
        number: r.number,
        rarity: r.rarity,
        image_url: r.imageUrl,
        set_name: r.setName,
        set_slug: r.setSlug,
        game_name: r.gameName,
        game_slug: r.gameSlug,
      })),
      page,
      limit,
      total: Number(count?.n ?? 0),
      query: q || undefined,
    });
  } catch (error) {
    console.error('Error searching products:', error);
    return apiError('Internal server error', 500);
  }
}
