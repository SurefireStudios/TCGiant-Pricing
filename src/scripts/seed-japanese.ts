/**
 * Japanese Pokémon Card Seeder — Seeds the database with card metadata from TCGdex API
 *
 * Usage:
 *   npx tsx src/scripts/seed-japanese.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';

const API_BASE = 'https://api.tcgdex.net/v2/ja';

interface TCGdexSetList {
  id: string;
  name: string;
  cardCount: { official: number; total: number };
}

interface TCGdexSetDetails {
  id: string;
  name: string;
  releaseDate?: string;
  cards: {
    id: string;
    localId: string;
    name: string;
    image?: string;
  }[];
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 5): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { headers });
      if (response.status === 429) {
        const waitTime = Math.pow(2, i) * 3000;
        console.log(`  ⏳ Rate limited, waiting ${waitTime / 1000}s...`);
        await sleep(waitTime);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      const waitTime = Math.pow(2, i) * 2000;
      console.log(`  ⚠️ Fetch error, retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchAllSets(): Promise<TCGdexSetList[]> {
  console.log('Fetching list of Japanese sets from TCGdex...');
  return await fetchWithRetry(`${API_BASE}/sets`);
}

async function fetchSetDetails(setId: string): Promise<TCGdexSetDetails> {
  return await fetchWithRetry(`${API_BASE}/sets/${setId}`);
}

async function seed() {
  const startTime = Date.now();

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing in .env.local');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const existingGames = await db.select().from(schema.games).where(eq(schema.games.slug, 'pokemon'));
  if (existingGames.length === 0) {
    console.error('Pokemon game not found in database. Run the US seeder first.');
    process.exit(1);
  }
  const gameId = existingGames[0].id;

  const sets = await fetchAllSets();
  console.log(`Found ${sets.length} Japanese sets.`);

  // Find sets already in the DB to skip
  const existingSetsResult = await db.select({ externalId: schema.sets.externalId }).from(schema.sets);
  const existingSetIds = new Set(existingSetsResult.map((s) => s.externalId));

  let setsProcessed = 0;
  let cardsInserted = 0;
  let setsSkipped = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    const setId = `ja-${set.id}`; // Prefix with ja- to avoid collisions with english sets if they share IDs

    if (existingSetIds.has(setId)) {
      process.stdout.write(`\r[${i + 1}/${sets.length}] ${set.name} — already seeded, skipping            `);
      setsSkipped++;
      continue;
    }

    console.log(`\n[${i + 1}/${sets.length}] Fetching set details: ${set.name} (${set.id})`);

    let setDetails;
    try {
      setDetails = await fetchSetDetails(encodeURIComponent(set.id));
    } catch (e: any) {
      console.error(`\nFailed to fetch set details for ${set.name}: ${e.message}`);
      continue;
    }

    // 1. Insert the set
    let internalSetId: number;
    try {
      const insertedSet = await db
        .insert(schema.sets)
        .values({
          gameId,
          name: setDetails.name,
          slug: slugify(`ja-${setDetails.name}-${set.id}`),
          series: 'Japanese', // Generic series name
          releaseDate: setDetails.releaseDate || new Date().toISOString().split('T')[0],
          printedTotal: set.cardCount?.official || setDetails.cards.length,
          totalCards: set.cardCount?.total || setDetails.cards.length,
          externalId: setId,
          symbolUrl: null,
          logoUrl: null,
        })
        .returning({ id: schema.sets.id });
      
      internalSetId = insertedSet[0].id;
    } catch (e: any) {
      console.error(`\nFailed to insert set ${set.name}: ${e.message}`);
      continue;
    }

    // 2. Insert the cards
    const variants: ("unlimited" | "1st_edition" | "reverse_holo")[] = ["unlimited", "1st_edition", "reverse_holo"];
    
    const cardsToInsert: any[] = [];
    setDetails.cards.forEach((c) => {
      // TCGdex images follow a standard CDN structure
      const imageUrl = c.image ? `${c.image}/high.webp` : `https://assets.tcgdex.net/ja/${set.id}/${c.localId}/high.webp`;
      
      for (const variant of variants) {
        const variantSuffix = variant === 'unlimited' ? '' : `-${variant.replace('_', '-')}`;
        cardsToInsert.push({
          setId: internalSetId,
          name: c.name,
          slug: slugify(`ja-${c.name}-${c.id}${variantSuffix}`),
          cardNumber: c.localId,
          rarity: null,
          cardType: 'Pokemon',
          supertype: 'Pokémon',
          hp: null,
          imageUrl: imageUrl,
          imageLargeUrl: imageUrl,
          externalId: `ja-${c.id}`,
          variant: variant,
          isActive: true,
        });
      }
    });

    if (cardsToInsert.length === 0) {
      console.log(`  No cards found for set ${set.name}`);
      continue;
    }

    // Insert cards in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < cardsToInsert.length; i += chunkSize) {
      const chunk = cardsToInsert.slice(i, i + chunkSize);
      try {
        await db.insert(schema.cards).values(chunk);
        cardsInserted += chunk.length;
      } catch (e: any) {
        console.error(`\nFailed to insert cards chunk for ${set.name}: ${e.message}`);
      }
    }
    
    setsProcessed++;
    
    // Slight delay to respect API limits
    await sleep(250);
  }

  const durationStr = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Japanese Seeding complete! (${durationStr}s)`);
  console.log(`   Sets processed: ${setsProcessed}`);
  console.log(`   Sets skipped: ${setsSkipped}`);
  console.log(`   Cards inserted: ${cardsInserted}`);
}

seed().catch(console.error);
