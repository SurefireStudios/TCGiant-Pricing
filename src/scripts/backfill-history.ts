import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../db/schema';
import { scrapePriceChartingCard } from '../lib/pc-scraper';
import { updatePricesForCards } from '../lib/price-updater';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function runBackfill() {
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const limitIdx = args.indexOf('--limit');
  const maxLimit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : (isTest ? 5 : Infinity);

  console.log(`====================================================`);
  console.log(`🚀 Starting PriceCharting Historical Data Backfill`);
  console.log(`Mode: ${isTest ? 'TEST (max 5 cards)' : maxLimit !== Infinity ? `LIMIT (${maxLimit} cards)` : 'FULL DATABASE'}`);
  console.log(`====================================================\n`);

  // Fetch all sets ordered by ID
  const allSets = await db
    .select({
      id: schema.sets.id,
      name: schema.sets.name,
      slug: schema.sets.slug,
      totalCards: schema.sets.totalCards,
    })
    .from(schema.sets)
    .orderBy(asc(schema.sets.id));

  console.log(`Found ${allSets.length} sets in database.\n`);

  let totalProcessed = 0;
  let totalSalesInserted = 0;
  let totalPricesUpdated = 0;
  let totalFailed = 0;

  for (let sIdx = 0; sIdx < allSets.length; sIdx++) {
    if (totalProcessed >= maxLimit) break;

    const setItem = allSets[sIdx];
    console.log(`\n----------------------------------------------------`);
    console.log(`📂 Set [${sIdx + 1}/${allSets.length}]: ${setItem.name}`);
    console.log(`----------------------------------------------------`);

    // Fetch cards for this set
    const setCards = await db
      .select({
        id: schema.cards.id,
        name: schema.cards.name,
        variant: schema.cards.variant,
        cardNumber: schema.cards.cardNumber,
        setName: schema.sets.name,
      })
      .from(schema.cards)
      .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
      .where(eq(schema.cards.setId, setItem.id))
      .orderBy(asc(schema.cards.id));

    console.log(`Found ${setCards.length} cards in set "${setItem.name}".`);

    for (let cIdx = 0; cIdx < setCards.length; cIdx++) {
      if (totalProcessed >= maxLimit) break;

      const card = setCards[cIdx];
      totalProcessed++;

      console.log(
        `[${totalProcessed}/${maxLimit === Infinity ? '?' : maxLimit}] ${card.name} (${card.variant}) #${card.cardNumber || 'N/A'}`
      );

      const res = await scrapePriceChartingCard(db, card);

      if (res.success) {
        totalSalesInserted += res.salesInserted;
        totalPricesUpdated += res.pricesUpdated;

        console.log(
          `   ✅ Success: ${res.salesInserted} sales, ${res.pricesUpdated} condition prices inserted.`
        );

        // Update pricing engine for this card if sales were inserted
        if (res.salesInserted > 0 || res.pricesUpdated > 0) {
          try {
            await updatePricesForCards([card.id]);
          } catch (err: any) {
            console.log(`   ⚠️ Price engine update note: ${err.message || String(err)}`);
          }
        }
      } else {
        totalFailed++;
        console.log(`   ❌ Failed: ${res.error || 'Page not found / Error'}`);
      }

      // Rate limit backoff delay (1.2 seconds)
      await delay(1200);
    }
  }

  console.log(`\n====================================================`);
  console.log(`🎉 Backfill Session Complete!`);
  console.log(`- Cards Processed: ${totalProcessed}`);
  console.log(`- Historical Sales Inserted: ${totalSalesInserted}`);
  console.log(`- Baseline Prices Updated: ${totalPricesUpdated}`);
  console.log(`- Cards Failed/Skipped: ${totalFailed}`);
  console.log(`====================================================\n`);
}

runBackfill().catch((err) => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
