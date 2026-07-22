/**
 * Pokémon Card Seeder — Seeds the database with card metadata from pokemontcg.io
 *
 * Improved version with:
 * - Batch inserts (50 cards at a time instead of 1-by-1)
 * - Retry logic for network failures
 * - Automatic resume (skips existing sets)
 *
 * Usage:
 *   npx tsx src/scripts/seed-pokemon.ts           # Seed all sets
 *   npx tsx src/scripts/seed-pokemon.ts --popular  # Seed popular sets only
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';

const API_BASE = 'https://api.pokemontcg.io/v2';

const POPULAR_SET_IDS = [
  'base1', 'base2', 'base3', 'base4', 'base5',
  'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4',
  'ecard1', 'ecard2', 'ecard3',
  'swsh12pt5', 'sv1', 'sv3pt5', 'sv4',
];

interface PokemonTcgSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  images: { symbol: string; logo: string };
}

interface PokemonTcgCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  number: string;
  rarity?: string;
  artist?: string;
  images: { small: string; large: string };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, apiKey?: string, retries = 5): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

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
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      const waitTime = Math.pow(2, i) * 2000;
      console.log(`  ⚠️ Fetch error, retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
  throw new Error('Max retries exceeded');
}

async function dbWithRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      const waitTime = Math.pow(2, i) * 1500;
      console.log(`  ⚠️ DB error, retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
  throw new Error('Max DB retries exceeded');
}

async function fetchAllSets(apiKey?: string): Promise<PokemonTcgSet[]> {
  const allSets: PokemonTcgSet[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = `${API_BASE}/sets?page=${page}&pageSize=250&orderBy=releaseDate`;
    const response = await fetchWithRetry(url, apiKey);
    const data = await response.json();
    allSets.push(...data.data);
    hasMore = data.data.length === 250;
    page++;
    if (hasMore) await sleep(500);
  }
  return allSets;
}

async function fetchCardsForSet(setId: string, apiKey?: string): Promise<PokemonTcgCard[]> {
  const allCards: PokemonTcgCard[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = `${API_BASE}/cards?q=set.id:${setId}&page=${page}&pageSize=250`;
    const response = await fetchWithRetry(url, apiKey);
    const data = await response.json();
    allCards.push(...data.data);
    hasMore = data.data.length === 250;
    page++;
    if (hasMore) await sleep(300);
  }
  return allCards;
}

async function main() {
  console.log('=== TCGiant Pokémon Card Seeder (v2 — Batch Mode) ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set.');
    process.exit(1);
  }

  const popularOnly = process.argv.includes('--popular');
  const apiKey = process.env.POKEMON_TCG_API_KEY || '';

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  console.log('✅ Connected to database\n');

  // Step 1: Ensure Pokemon game exists
  console.log('📦 Checking Pokemon game entry...');
  const existingGames = await dbWithRetry(() =>
    db.select().from(schema.games).where(eq(schema.games.slug, 'pokemon'))
  );

  let gameId: number;
  if (existingGames.length > 0) {
    gameId = existingGames[0].id;
    console.log(`   Found existing game (id: ${gameId})`);
  } else {
    const [newGame] = await dbWithRetry(() =>
      db.insert(schema.games).values({
        name: 'Pokemon', slug: 'pokemon', imageUrl: null, isActive: true, sortOrder: 1,
      }).returning()
    );
    gameId = newGame.id;
    console.log(`   Created game (id: ${gameId})`);
  }

  // Step 2: Fetch sets
  console.log('\n🔍 Fetching sets from pokemontcg.io...');
  let allSets = await fetchAllSets(apiKey);
  console.log(`   Found ${allSets.length} total sets`);

  if (popularOnly) {
    allSets = allSets.filter((s) => POPULAR_SET_IDS.includes(s.id));
    console.log(`   Filtering to ${allSets.length} popular sets`);
  }

  // Step 3: Process each set
  let totalCardsInserted = 0;
  let totalSetsProcessed = 0;
  let setsSkipped = 0;

  for (let i = 0; i < allSets.length; i++) {
    const tcgSet = allSets[i];
    const setSlug = `pokemon-${slugify(tcgSet.name)}`;
    const progress = `[${i + 1}/${allSets.length}]`;

    // Check if set already has cards (skip if fully seeded)
    const existingSets = await dbWithRetry(() =>
      db.select().from(schema.sets).where(eq(schema.sets.externalId, tcgSet.id))
    );

    let setId: number;
    if (existingSets.length > 0) {
      setId = existingSets[0].id;

      // Check if cards already exist for this set
      const existingCardCount = await dbWithRetry(() =>
        db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.setId, setId)).limit(1)
      );

      if (existingCardCount.length > 0) {
        setsSkipped++;
        process.stdout.write(`\r  ${progress} ${tcgSet.name} — already seeded, skipping          `);
        continue;
      }
    } else {
      const [newSet] = await dbWithRetry(() =>
        db.insert(schema.sets).values({
          gameId, name: tcgSet.name, slug: setSlug, series: tcgSet.series,
          releaseDate: tcgSet.releaseDate, totalCards: tcgSet.total,
          printedTotal: tcgSet.printedTotal, imageUrl: tcgSet.images.logo,
          symbolUrl: tcgSet.images.symbol, externalId: tcgSet.id, isActive: true,
        }).returning()
      );
      setId = newSet.id;
    }

    // Fetch cards from API
    process.stdout.write(`\r  ${progress} ${tcgSet.name} — fetching cards...                    `);
    const cards = await fetchCardsForSet(tcgSet.id, apiKey);

    // Helper to determine variants for a set
    function getVariantsForSet(series: string, setName: string): ("unlimited" | "1st_edition" | "reverse_holo" | "shadowless")[] {
      if (setName === "Base" || setName === "Base Set") return ["unlimited", "1st_edition", "shadowless"];
      if (["Jungle", "Fossil", "Team Rocket", "Gym Heroes", "Gym Challenge", "Neo Genesis", "Neo Discovery", "Neo Revelation", "Neo Destiny"].includes(setName)) {
        return ["unlimited", "1st_edition"];
      }
      if (["Black & White", "XY", "Sun & Moon", "Sword & Shield", "Scarlet & Violet", "HeartGold & SoulSilver", "Diamond & Pearl", "Platinum", "EX", "E-Card"].includes(series)) {
        return ["unlimited", "reverse_holo"];
      }
      return ["unlimited"];
    }

    const variants = getVariantsForSet(tcgSet.series, tcgSet.name);

    // Batch insert cards (chunks of 40 * variants)
    const BATCH_SIZE = 40;
    for (let b = 0; b < cards.length; b += BATCH_SIZE) {
      const batch = cards.slice(b, b + BATCH_SIZE);

      const values: any[] = [];
      for (const card of batch) {
        for (const variant of variants) {
          // If it's a Pokemon-EX, Pokemon-V, etc. they typically don't have reverse holos, but we'll include it for simplicity
          // or filter out if rarity is Ultra Rare. We'll just generate them for now.
          const variantSuffix = variant === 'unlimited' ? '' : `-${variant.replace('_', '-')}`;
          
          values.push({
            setId,
            name: card.name,
            slug: `pokemon-${slugify(tcgSet.name)}-${slugify(card.name)}-${card.number.replace('/', '-')}${variantSuffix}`,
            cardNumber: card.number,
            rarity: card.rarity || 'Unknown',
            supertype: card.supertype,
            subtypes: card.subtypes ? JSON.stringify(card.subtypes) : null,
            hp: card.hp || null,
            imageUrl: card.images.small,
            imageLargeUrl: card.images.large,
            externalId: card.id,
            artist: card.artist || null,
            variant: variant,
            isActive: true,
            scrapePreiority: card.rarity === 'Rare Holo' ? 10 : 1,
          });
        }
      }

      await dbWithRetry(() => db.insert(schema.cards).values(values));
      totalCardsInserted += batch.length;

      process.stdout.write(
        `\r  ${progress} ${tcgSet.name} — ${Math.min(b + BATCH_SIZE, cards.length)}/${cards.length} cards          `
      );

      // Brief pause between batches to avoid overwhelming Neon
      await sleep(200);
    }

    totalSetsProcessed++;

    // Pause between sets
    await sleep(apiKey ? 200 : 700);
  }

  console.log(`\n\n✅ Seeding complete!`);
  console.log(`   Sets processed: ${totalSetsProcessed}`);
  console.log(`   Sets skipped (already seeded): ${setsSkipped}`);
  console.log(`   Cards inserted: ${totalCardsInserted}`);
}

main().catch((err) => {
  console.error('\n❌ Seeder failed:', err.message || err);
  console.log('\n💡 The seeder is resumable — just run it again to continue from where it left off.');
  process.exit(1);
});
