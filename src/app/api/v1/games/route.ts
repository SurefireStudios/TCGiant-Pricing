/** API Route: GET /api/v1/games — enabled games, with counts. */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { desc, eq, sql } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.valid) return apiError(auth.error, auth.status, auth.retryAfter);

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
    const rows = await db
      .select({
        id: schema.tcgCategories.id,
        name: schema.tcgCategories.name,
        slug: schema.tcgCategories.slug,
        sets: sql<number>`count(distinct ${schema.tcgGroups.id})`,
        products: sql<number>`count(distinct ${schema.tcgProducts.id})`,
      })
      .from(schema.tcgCategories)
      .leftJoin(schema.tcgGroups, eq(schema.tcgGroups.categoryId, schema.tcgCategories.id))
      .leftJoin(schema.tcgProducts, eq(schema.tcgProducts.groupId, schema.tcgGroups.id))
      .where(eq(schema.tcgCategories.isEnabled, true))
      .groupBy(schema.tcgCategories.id, schema.tcgCategories.name, schema.tcgCategories.slug)
      .orderBy(desc(sql`count(distinct ${schema.tcgProducts.id})`));

    return apiSuccess({
      games: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        slug: r.slug,
        sets: Number(r.sets),
        products: Number(r.products),
      })),
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    return apiError('Internal server error', 500);
  }
}
