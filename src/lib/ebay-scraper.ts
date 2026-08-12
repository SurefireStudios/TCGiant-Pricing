/**
 * eBay Scraper — Scrapes sold listings for individual cards
 *
 * This module orchestrates the scraping pipeline:
 * 1. Takes a card from the database
 * 2. Searches eBay for completed/sold listings
 * 3. Parses grades from listing titles
 * 4. Inserts new sales (deduplicates by ebay_item_id)
 * 5. Returns stats for the pricing engine to process
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, sql, asc, desc, isNull, or } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { parseGrade, type GradeResult } from './grade-parser';
import { ebayInsightsSource } from './sources/ebay-insights';
import type { SoldSale } from './sold-data-source';

// --- Types ---

export interface ScrapeResult {
  cardId: number;
  cardName: string;
  setName: string;
  ebayResultCount: number;
  newSalesInserted: number;
  duplicatesSkipped: number;
  errors: string[];
}

export interface ScraperStats {
  cardsProcessed: number;
  totalEbayResults: number;
  totalNewSales: number;
  totalDuplicates: number;
  totalErrors: number;
  duration_ms: number;
  results: ScrapeResult[];
}

// --- Card Selection ---

/**
 * Select the next batch of cards to scrape.
 *
 * Priority order:
 * 1. Higher scrape_priority first (rare holos, EX, etc.)
 * 2. Least recently scraped first (NULL last_scraped_at = never scraped)
 * 3. Limit to batchSize cards per run
 */
export async function selectCardsToScrape(
  db: ReturnType<typeof drizzle>,
  batchSize: number = 50
) {
  const cards = await db
    .select({
      id: schema.cards.id,
      name: schema.cards.name,
      cardNumber: schema.cards.cardNumber,
      setId: schema.cards.setId,
      setName: schema.sets.name,
      variant: schema.cards.variant,
      externalId: schema.cards.externalId,
      scrapePreiority: schema.cards.scrapePreiority,
      lastScrapedAt: schema.cards.lastScrapedAt,
    })
    .from(schema.cards)
    .leftJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
    .where(eq(schema.cards.isActive, true))
    .orderBy(
      desc(schema.cards.scrapePreiority),
      sql`${schema.cards.lastScrapedAt} ASC NULLS FIRST`,
      asc(schema.cards.setId),
      asc(schema.cards.id)
    )
    .limit(batchSize);

  return cards;
}

// --- Single Card Scraper ---

/**
 * Scrape a single card's sold listings from eBay.
 *
 * Steps:
 * 1. Search eBay for sold listings matching this card
 * 2. Parse each listing title to determine grade/condition
 * 3. Insert new sales into the database (skip duplicates)
 * 4. Update the card's last_scraped_at timestamp
 */
export async function scrapeCard(
  db: ReturnType<typeof drizzle>,
  card: {
    id: number;
    name: string;
    cardNumber: string | null;
    setName: string | null;
    variant: string;
  }
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    cardId: card.id,
    cardName: card.name,
    setName: card.setName || 'Unknown',
    ebayResultCount: 0,
    newSalesInserted: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  try {
    // Step 1: Fetch genuine SOLD data.
    //
    // This used to call searchSoldPokemonCards, which is backed by the Browse
    // API and returns ACTIVE listings — so every "sale" recorded here was an
    // asking price with a future listing-end date standing in for a sale date.
    // Those rows are gone; this path now uses Marketplace Insights, the only
    // official source of eBay sold data.
    const soldItems: SoldSale[] = await ebayInsightsSource.fetchSales({
      cardName: card.name,
      setName: card.setName || '',
      cardNumber: card.cardNumber,
      variant: card.variant,
      limit: 100,
    });

    result.ebayResultCount = soldItems.length;

    if (soldItems.length === 0) {
      return result;
    }

    // Step 2: Process each sold listing
    const valuesToInsert = [];
    for (const item of soldItems) {
      try {
        // Parse the grade from the title
        const gradeResult: GradeResult = parseGrade(item.title);

        // ONLY insert this sale if the parsed variant matches the card's variant
        // (e.g. don't attach an Unlimited sale to the 1st Edition card)
        if (gradeResult.variant !== card.variant) continue;

        valuesToInsert.push({
          cardId: card.id,
          condition: gradeResult.condition as typeof schema.cardConditionEnum.enumValues[number],
          gradingCompany: gradeResult.gradingCompany as typeof schema.gradingCompanyEnum.enumValues[number],
          gradeValue: gradeResult.gradeValue?.toString() ?? null,
          salePrice: item.price,
          saleDate: item.soldDate,
          ebayItemId: item.externalId,
          ebayTitle: item.title,
          ebayUrl: item.url,
          source: item.source,
          isOutlier: false,
          gradeConfidence: gradeResult.confidence,
        });
      } catch (err: any) {
        result.errors.push(`Item ${item.externalId}: ${err.message}`);
      }
    }

    if (valuesToInsert.length > 0) {
      // Bulk insert ignoring duplicates by ebay_item_id unique index
      const insertResult = await db
        .insert(schema.sales)
        .values(valuesToInsert)
        .onConflictDoNothing({ target: schema.sales.ebayItemId })
        .returning({ id: schema.sales.id });

      result.newSalesInserted = insertResult.length;
      result.duplicatesSkipped = valuesToInsert.length - insertResult.length;
    }

    // Step 3: Update last_scraped_at
    await db
      .update(schema.cards)
      .set({ lastScrapedAt: new Date() })
      .where(eq(schema.cards.id, card.id));

  } catch (err: any) {
    result.errors.push(`Search failed: ${err.message}`);
  }

  return result;
}


// --- Batch Scraper ---

/**
 * Run a full scraper batch.
 *
 * This is the main entry point called by the cron job.
 * It selects cards, scrapes them, and returns stats.
 */
export async function runScraperBatch(
  batchSize: number = 50
): Promise<ScraperStats> {
  const startTime = Date.now();

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  // Select cards to scrape
  const cards = await selectCardsToScrape(db, batchSize);

  const stats: ScraperStats = {
    cardsProcessed: 0,
    totalEbayResults: 0,
    totalNewSales: 0,
    totalDuplicates: 0,
    totalErrors: 0,
    duration_ms: 0,
    results: [],
  };

  // Process each card with a small delay between requests
  for (const card of cards) {
    const result = await scrapeCard(db, {
      id: card.id,
      name: card.name,
      cardNumber: card.cardNumber,
      setName: card.setName,
      variant: card.variant,
    });

    stats.cardsProcessed++;
    stats.totalEbayResults += result.ebayResultCount;
    stats.totalNewSales += result.newSalesInserted;
    stats.totalDuplicates += result.duplicatesSkipped;
    stats.totalErrors += result.errors.length;
    stats.results.push(result);

    // Rate limit: 500ms between cards to stay under eBay's rate limits
    await new Promise((r) => setTimeout(r, 500));

    // Safety: if we're approaching Vercel's 60s timeout, stop
    if (Date.now() - startTime > 55_000) {
      console.log(`[SCRAPER] Approaching timeout, stopping at ${stats.cardsProcessed} cards`);
      break;
    }
  }

  stats.duration_ms = Date.now() - startTime;

  return stats;
}
