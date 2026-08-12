/** API Route: GET /api/v1/sets — sets, optionally filtered by game. */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, desc, eq, sql } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.valid) return apiError(auth.error, auth.status, auth.retryAfter);

  const game = request.nextUrl.searchParams.get('game');

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
    const filters = [eq(schema.tcgCategories.isEnabled, true)];
    if (game) filters.push(eq(schema.tcgCategories.slug, game));

    const rows = await db
      .select({
        id: schema.tcgGroups.id,
        name: schema.tcgGroups.name,
        slug: schema.tcgGroups.slug,
        publishedOn: schema.tcgGroups.publishedOn,
        gameSlug: schema.tcgCategories.slug,
        products: sql<number>`count(distinct ${schema.tcgProducts.id})`,
      })
      .from(schema.tcgGroups)
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgGroups.categoryId))
      .leftJoin(schema.tcgProducts, eq(schema.tcgProducts.groupId, schema.tcgGroups.id))
      .where(and(...filters))
      .groupBy(
        schema.tcgGroups.id,
        schema.tcgGroups.name,
        schema.tcgGroups.slug,
        schema.tcgGroups.publishedOn,
        schema.tcgCategories.slug
      )
      .orderBy(desc(schema.tcgGroups.publishedOn));

    return apiSuccess({
      sets: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        slug: r.slug,
        game_slug: r.gameSlug,
        released: r.publishedOn,
        products: Number(r.products),
      })),
    });
  } catch (error) {
    console.error('Error fetching sets:', error);
    return apiError('Internal server error', 500);
  }
}
