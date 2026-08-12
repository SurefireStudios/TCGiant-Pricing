/**
 * API Route: GET /api/search
 *
 * Public typeahead for the site's own search box. Deliberately separate from
 * /api/v1/*, which is the keyed product API.
 *
 * The search box previously called /api/v1/cards with an API key hardcoded in
 * client-side JavaScript. That is either broken (if the key was a placeholder)
 * or a leak of the unlimited internal key to every visitor. Neither is
 * acceptable, and a card-name lookup does not need authentication — it needs a
 * narrow surface and a rate limit.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq, ilike, isNotNull, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; resetAt: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  return ++e.n > RATE_LIMIT;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return Response.json({ results: [] });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (limited(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

    const rows = await db
      .select({
        name: schema.tcgProducts.name,
        slug: schema.tcgProducts.slug,
        number: schema.tcgProducts.number,
        imageUrl: schema.tcgProducts.imageUrl,
        setName: schema.tcgGroups.name,
        gameName: schema.tcgCategories.name,
        price: sql<number | null>`max(${schema.tcgLatestPrices.marketPrice})`,
      })
      .from(schema.tcgProducts)
      .innerJoin(schema.tcgGroups, eq(schema.tcgGroups.id, schema.tcgProducts.groupId))
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgProducts.categoryId))
      .leftJoin(schema.tcgLatestPrices, eq(schema.tcgLatestPrices.productId, schema.tcgProducts.id))
      .where(
        and(
          eq(schema.tcgCategories.isEnabled, true),
          ilike(schema.tcgProducts.name, `%${q}%`),
          // TCGplayer's catalogue includes sealed product, code cards, tins and
          // display cases. A collector number is what separates a card from a
          // box: 37,722 numbered products vs 5,698 unnumbered, and every
          // unnumbered sample is packaging. This is a card price guide.
          isNotNull(schema.tcgProducts.number)
        )
      )
      .groupBy(
        schema.tcgProducts.id,
        schema.tcgProducts.name,
        schema.tcgProducts.slug,
        schema.tcgProducts.number,
        schema.tcgProducts.imageUrl,
        schema.tcgGroups.name,
        schema.tcgCategories.name
      )
      // Most valuable first — the card someone means is usually the expensive
      // one. NULLS LAST matters: Postgres sorts nulls first on DESC, which put
      // unpriced products at the top of every search.
      .orderBy(sql`max(${schema.tcgLatestPrices.marketPrice}) DESC NULLS LAST`)
      .limit(8);

    return Response.json({
      results: rows.map((r) => ({
        name: r.name,
        slug: r.slug,
        number: r.number,
        image_url: r.imageUrl,
        set_name: r.setName,
        game_name: r.gameName,
        price: r.price,
      })),
    });
  } catch (error) {
    console.error('search failed:', error);
    return Response.json({ results: [] }, { status: 500 });
  }
}
