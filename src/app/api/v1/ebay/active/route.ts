import { NextRequest, NextResponse } from 'next/server';
import { searchActivePokemonCards } from '@/lib/ebay-client';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

export const revalidate = 60; // Cache for 1 minute

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const cardIdStr = searchParams.get('cardId');
  const storeUsername = searchParams.get('storeUsername') || process.env.EBAY_STORE_USERNAME;

  if (!cardIdStr) {
    return NextResponse.json({ error: 'Missing cardId parameter' }, { status: 400 });
  }

  const cardId = parseInt(cardIdStr, 10);
  if (isNaN(cardId)) {
    return NextResponse.json({ error: 'Invalid cardId' }, { status: 400 });
  }

  try {
    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Fetch the card and its set using a join
    const cardResult = await db
      .select({
        name: schema.cards.name,
        cardNumber: schema.cards.cardNumber,
        setName: schema.sets.name,
      })
      .from(schema.cards)
      .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .where(eq(schema.cards.id, cardId))
      .limit(1);

    if (!cardResult || cardResult.length === 0) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const card = cardResult[0];

    // 1. Fetch store-specific listings (if store configured)
    let storeListings: any[] = [];
    if (storeUsername) {
      storeListings = await searchActivePokemonCards(
        card.name,
        card.setName,
        card.cardNumber,
        { limit: 3, sellerUsername: storeUsername }
      );
    }

    // 2. Fetch general listings (fill up to 10 total)
    const limitRemaining = 10 - storeListings.length;
    let generalListings: any[] = [];
    
    if (limitRemaining > 0) {
      generalListings = await searchActivePokemonCards(
        card.name,
        card.setName,
        card.cardNumber,
        { limit: limitRemaining }
      );
    }

    // Filter out duplicates (if store listing also appeared in general)
    const storeItemIds = new Set(storeListings.map((i) => i.itemId));
    const uniqueGeneral = generalListings.filter((i) => !storeItemIds.has(i.itemId));

    // Combine them, putting store listings first
    const activeListings = [...storeListings, ...uniqueGeneral];

    return NextResponse.json({
      success: true,
      listings: activeListings,
      featuredStore: storeUsername,
    });
  } catch (error: any) {
    console.error('Failed to fetch active eBay listings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
