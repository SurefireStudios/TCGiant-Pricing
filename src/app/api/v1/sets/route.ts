/**
 * API Route: GET /api/v1/sets
 *
 * List all card sets, optionally filtered by game.
 *
 * Parameters:
 * - game: Filter by game slug (default: returns all)
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 50, max: 200)
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, sql, desc } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  const url = new URL(request.url);
  const gameSlug = url.searchParams.get('game');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Build query
    let query = db
      .select({
        id: schema.sets.id,
        name: schema.sets.name,
        slug: schema.sets.slug,
        series: schema.sets.series,
        releaseDate: schema.sets.releaseDate,
        totalCards: schema.sets.totalCards,
        imageUrl: schema.sets.imageUrl,
        symbolUrl: schema.sets.symbolUrl,
        gameName: schema.games.name,
        gameSlug: schema.games.slug,
      })
      .from(schema.sets)
      .innerJoin(schema.games, eq(schema.sets.gameId, schema.games.id))
      .orderBy(desc(schema.sets.releaseDate))
      .limit(limit)
      .offset(offset);

    // Apply game filter if provided
    if (gameSlug) {
      query = query.where(eq(schema.games.slug, gameSlug)) as typeof query;
    }

    const sets = await query;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sets);
    const total = Number(countResult[0]?.count || 0);

    return apiSuccess({
      sets: sets.map((s) => ({
        id: s.id.toString(),
        name: s.name,
        slug: s.slug,
        game: s.gameName,
        game_slug: s.gameSlug,
        series: s.series,
        release_date: s.releaseDate,
        total_cards: s.totalCards,
        image_url: s.imageUrl,
        symbol_url: s.symbolUrl,
      })),
      page,
      limit,
      total,
      game: gameSlug || 'all',
    });
  } catch (error) {
    console.error('Error fetching sets:', error);
    return apiError('Internal server error', 500);
  }
}
