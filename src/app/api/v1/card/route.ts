/**
 * API Route: GET /api/v1/card
 *
 * A single product with every finish's current price.
 * Accepts ?id= (TCGplayer productId) or ?slug=.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { asc, eq } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (!auth.valid) return apiError(auth.error, auth.status, auth.retryAfter);

  const params = request.nextUrl.searchParams;
  const id = params.get('id');
  const slug = params.get('slug');
  if (!id && !slug) return apiError('Provide id or slug');

  try {
    const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

    const [product] = await db
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
      .where(id ? eq(schema.tcgProducts.id, parseInt(id, 10)) : eq(schema.tcgProducts.slug, slug!))
      .limit(1);

    if (!product) return apiError('Product not found', 404);

    const prices = await db
      .select()
      .from(schema.tcgLatestPrices)
      .where(eq(schema.tcgLatestPrices.productId, product.id))
      .orderBy(asc(schema.tcgLatestPrices.subType));

    return apiSuccess({
      product: {
        id: String(product.id),
        name: product.name,
        slug: product.slug,
        number: product.number,
        rarity: product.rarity,
        image_url: product.imageUrl,
        set_name: product.setName,
        set_slug: product.setSlug,
        game_name: product.gameName,
        game_slug: product.gameSlug,
      },
      // Raw prices only — graded is not tracked, and saying so beats implying it.
      prices: prices.map((p) => ({
        finish: p.subType,
        market_price: p.marketPrice,
        low_price: p.lowPrice,
        mid_price: p.midPrice,
        high_price: p.highPrice,
        as_of: p.asOf,
      })),
      condition: 'raw',
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return apiError('Internal server error', 500);
  }
}
