/**
 * API Route: GET /api/v1/games
 *
 * List all supported TCG brands/games.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const db = drizzle(sql, { schema });

    const games = await db
      .select()
      .from(schema.games)
      .orderBy(schema.games.sortOrder);

    return apiSuccess({
      games: games.map((g) => ({
        id: g.id.toString(),
        name: g.name,
        slug: g.slug,
        is_active: g.isActive,
        image_url: g.imageUrl,
      })),
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    return apiError('Internal server error', 500);
  }
}
