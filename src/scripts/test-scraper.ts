/**
 * Test Scraper Script — Manually test the eBay scraper on a single card
 *
 * Usage:
 *   npx tsx src/scripts/test-scraper.ts                    # Test connection only
 *   npx tsx src/scripts/test-scraper.ts --card "Charizard"  # Scrape a specific card
 *   npx tsx src/scripts/test-scraper.ts --full              # Run a full batch (30 cards)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { testConnection, searchSoldPokemonCards } from '../lib/ebay-client';
import { parseGrade } from '../lib/grade-parser';
import { runScraperBatch } from '../lib/ebay-scraper';
import { updatePricesForCards } from '../lib/price-updater';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { ilike, eq } from 'drizzle-orm';
import * as schema from '../db/schema';

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--full')
    ? 'full'
    : args.includes('--card')
      ? 'card'
      : 'test';

  console.log('=== TCGiant eBay Scraper Test ===\n');

  // Step 1: Test eBay connection
  console.log('🔌 Testing eBay connection...');
  const connectionTest = await testConnection();

  if (!connectionTest.success) {
    console.error(`❌ Connection failed: ${connectionTest.message}`);
    console.log('\nMake sure these env vars are set in .env.local:');
    console.log('  EBAY_CLIENT_ID=your_client_id');
    console.log('  EBAY_CLIENT_SECRET=your_client_secret');
    console.log('  EBAY_ENVIRONMENT=PRODUCTION');
    process.exit(1);
  }

  console.log(`✅ ${connectionTest.message}\n`);

  if (mode === 'test') {
    // Just test the connection + a sample search
    console.log('🔍 Running sample search for "Charizard Base Set"...');
    const results = await searchSoldPokemonCards('Charizard', 'Base', '4/102', { limit: 5 });
    console.log(`   Found ${results.length} results:\n`);

    for (const item of results) {
      const grade = parseGrade(item.title);
      console.log(`   💰 $${(item.price / 100).toFixed(2)} — ${item.title}`);
      console.log(`      Grade: ${grade.gradingCompany} ${grade.gradeValue ?? 'N/A'} → ${grade.condition} (${grade.confidence})`);
      console.log(`      eBay: ${item.itemUrl}`);
      console.log('');
    }

    return;
  }

  if (mode === 'card') {
    // Scrape a specific card
    const cardNameArg = args[args.indexOf('--card') + 1];
    if (!cardNameArg) {
      console.error('❌ Please provide a card name: --card "Charizard"');
      process.exit(1);
    }

    console.log(`🃏 Looking up "${cardNameArg}" in database...`);

    const sqlClient = neon(process.env.DATABASE_URL!);
    const db = drizzle(sqlClient, { schema });

    // Find the card in the database
    const cards = await db
      .select({
        id: schema.cards.id,
        name: schema.cards.name,
        cardNumber: schema.cards.cardNumber,
        setName: schema.sets.name,
      })
      .from(schema.cards)
      .leftJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .where(ilike(schema.cards.name, `%${cardNameArg}%`))
      .limit(5);

    if (cards.length === 0) {
      console.error(`❌ No cards found matching "${cardNameArg}"`);
      process.exit(1);
    }

    console.log(`   Found ${cards.length} matching cards. Using first: "${cards[0].name}" from "${cards[0].setName}"\n`);

    const card = cards[0];

    // Search eBay for this card
    console.log('🔍 Searching eBay for sold listings...');
    const soldItems = await searchSoldPokemonCards(
      card.name,
      card.setName || '',
      card.cardNumber,
      { limit: 20 }
    );

    console.log(`   Found ${soldItems.length} results:\n`);

    for (const item of soldItems) {
      const grade = parseGrade(item.title);
      console.log(`   💰 $${(item.price / 100).toFixed(2)} — ${item.title}`);
      console.log(`      → ${grade.condition} (${grade.gradingCompany} ${grade.gradeValue ?? 'ungraded'}, confidence: ${grade.confidence})`);
      console.log(`      🔗 ${item.itemUrl}`);
      console.log('');
    }

    // Ask if we should insert
    console.log('---');
    console.log(`Total: ${soldItems.length} sold listings found`);
    console.log('To insert these into the database and compute prices, run:');
    console.log('  npx tsx src/scripts/test-scraper.ts --full\n');

    return;
  }

  if (mode === 'full') {
    // Full batch run
    console.log('🚀 Running full scraper batch (30 cards)...\n');

    const stats = await runScraperBatch(30);

    console.log(`\n📊 Scraper Results:`);
    console.log(`   Cards processed: ${stats.cardsProcessed}`);
    console.log(`   eBay results: ${stats.totalEbayResults}`);
    console.log(`   New sales inserted: ${stats.totalNewSales}`);
    console.log(`   Duplicates skipped: ${stats.totalDuplicates}`);
    console.log(`   Errors: ${stats.totalErrors}`);
    console.log(`   Duration: ${(stats.duration_ms / 1000).toFixed(1)}s`);

    // Show per-card breakdown
    console.log(`\n   Per-card breakdown:`);
    for (const r of stats.results) {
      const status = r.errors.length > 0 ? '⚠️' : r.newSalesInserted > 0 ? '✅' : '—';
      console.log(`   ${status} ${r.cardName} (${r.setName}): ${r.newSalesInserted} new / ${r.ebayResultCount} found`);
      for (const err of r.errors) {
        console.log(`      ❌ ${err}`);
      }
    }

    // Run pricing engine
    const cardsWithSales = stats.results
      .filter((r) => r.newSalesInserted > 0)
      .map((r) => r.cardId);

    if (cardsWithSales.length > 0) {
      console.log(`\n💰 Running pricing engine on ${cardsWithSales.length} cards...`);
      const priceStats = await updatePricesForCards(cardsWithSales);
      console.log(`   Prices computed: ${priceStats.pricesComputed}`);
      console.log(`   Snapshots created: ${priceStats.snapshotsCreated}`);
      console.log(`   Outliers marked: ${priceStats.outliersMarked}`);
      console.log(`   Duration: ${(priceStats.duration_ms / 1000).toFixed(1)}s`);
    } else {
      console.log('\n💤 No new sales found — pricing engine skipped.');
    }

    console.log('\n✅ Done!');
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
