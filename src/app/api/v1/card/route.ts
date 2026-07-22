/**
 * API Route: GET /api/v1/card
 *
 * Get a single card with all price data across all conditions.
 *
 * Parameters:
 * - id: Card ID (integer)
 * - slug: Card slug (string)
 * - q: Search query (returns first match)
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, ilike } from 'drizzle-orm';
import { validateApiKey, apiError, apiSuccess } from '@/lib/api-auth';
import * as schema from '@/db/schema';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.valid) {
    return apiError(authResult.error, authResult.status);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const slug = url.searchParams.get('slug');
  const q = url.searchParams.get('q');

  if (!id && !slug && !q) {
    return apiError('One of id, slug, or q parameter is required.');
  }

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Build where clause based on provided param
    let whereClause;
    if (id) {
      whereClause = eq(schema.cards.id, parseInt(id));
    } else if (slug) {
      whereClause = eq(schema.cards.slug, slug);
    } else if (q) {
      whereClause = ilike(schema.cards.name, `%${q}%`);
    }

    const results = await db
      .select({
        id: schema.cards.id,
        name: schema.cards.name,
        slug: schema.cards.slug,
        cardNumber: schema.cards.cardNumber,
        rarity: schema.cards.rarity,
        supertype: schema.cards.supertype,
        subtypes: schema.cards.subtypes,
        hp: schema.cards.hp,
        imageUrl: schema.cards.imageUrl,
        imageLargeUrl: schema.cards.imageLargeUrl,
        artist: schema.cards.artist,
        setName: schema.sets.name,
        setSlug: schema.sets.slug,
        gameName: schema.games.name,
        gameSlug: schema.games.slug,
      })
      .from(schema.cards)
      .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .innerJoin(schema.games, eq(schema.sets.gameId, schema.games.id))
      .where(whereClause)
      .limit(1);

    if (results.length === 0) {
      return apiError('Card not found', 404);
    }

    const card = results[0];

    // Fetch current prices for this card
    const prices = await db
      .select()
      .from(schema.currentPrices)
      .where(eq(schema.currentPrices.cardId, card.id));

    // Build prices object
    const priceMap: Record<string, number | null> = {};
    for (const p of prices) {
      const key = p.condition.toLowerCase();
      priceMap[key] = p.marketPrice;
    }

    return apiSuccess({
      id: card.id.toString(),
      name: card.name,
      slug: card.slug,
      card_number: card.cardNumber,
      rarity: card.rarity,
      supertype: card.supertype,
      subtypes: card.subtypes ? JSON.parse(card.subtypes) : [],
      hp: card.hp,
      image_url: card.imageUrl,
      image_large_url: card.imageLargeUrl,
      artist: card.artist,
      set_name: card.setName,
      set_slug: card.setSlug,
      game: card.gameName,
      game_slug: card.gameSlug,
      prices: priceMap,
      last_updated: new Date().toISOString().split('T')[0],
    });
  } catch (error) {
    console.error('Error fetching card:', error);
    return apiError('Internal server error', 500);
  }
}
