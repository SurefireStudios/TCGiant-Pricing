import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { db } from '../db';
import { cards, sets } from '../db/schema';
import { eq, inArray, and, not, ne } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);

// Helper to convert DB set name to PriceCharting console
function getPriceChartingConsole(setName: string): string {
  let lower = setName.toLowerCase().replace(/ /g, '-').replace(/&/g, 'and');
  if (lower === 'base') return 'pokemon-base-set';
  return `pokemon-${lower}`;
}

// Helper to convert DB card details to PriceCharting game name
function getPriceChartingGameName(cardName: string, variant: string, cardNumber: string): string {
  // Strip out special characters that PC doesn't use in URLs
  let lowerName = cardName.toLowerCase().replace(/ /g, '-').replace(/&/g, 'and').replace(/'/g, '').replace(/\./g, '');
  
  let pcVariant = '';
  if (variant === '1st_edition') pcVariant = '-1st-edition';
  if (variant === 'shadowless') pcVariant = '-shadowless';
  if (variant === 'reverse_holo') pcVariant = '-reverse-foil';
  
  return `${lowerName}${pcVariant}-${cardNumber}`;
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function run() {
  console.log("Starting PriceCharting Image Scraper...");

  // Fetch all variants that are NOT unlimited (or optionally unlimited if we want to replace them too)
  // Let's just focus on '1st_edition' and 'shadowless' for the Base set first to verify, then expand.
  
  const targetCards = await db.select({
    id: cards.id,
    name: cards.name,
    variant: cards.variant,
    cardNumber: cards.cardNumber,
    setName: sets.name,
  }).from(cards)
    .innerJoin(sets, eq(cards.setId, sets.id))
    .where(inArray(cards.variant, ['1st_edition', 'shadowless', 'reverse_holo']));

  console.log(`Found ${targetCards.length} variant cards to scrape.`);

  let successCount = 0;
  let failCount = 0;
  let limit = targetCards.length;
  if (process.argv.includes('--test')) {
    limit = Math.min(10, targetCards.length);
    console.log(`[TEST MODE] Only processing the first ${limit} cards.`);
  }

  for (let i = 0; i < targetCards.length && successCount + failCount < limit; i++) {
    const card = targetCards[i];
    
    // Skip Japanese cards for now (PriceCharting uses different URL structures for JP)
    if (/[^\x00-\x7F]/.test(card.name) || /[^\x00-\x7F]/.test(card.setName)) {
      continue;
    }

    if (!card.cardNumber) {
      console.log(`[${i+1}/${targetCards.length}] Skipping ${card.name} - No card number`);
      continue;
    }

    const consoleSlug = getPriceChartingConsole(card.setName);
    const gameSlug = getPriceChartingGameName(card.name, card.variant, card.cardNumber);
    const url = `https://www.pricecharting.com/game/${consoleSlug}/${gameSlug}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
         console.log(`[${i+1}/${targetCards.length}] ❌ HTML Fetch failed (404/etc): ${url}`);
         failCount++;
         await delay(1000); // Backoff
         continue;
      }
      
      const html = await response.text();
      
      // Extract image URL using Regex
      const namePart = card.name.substring(0, 4).replace(/[^a-z0-9]/gi, '');
      const imgRegex = new RegExp(`<img[^>]+src=["']([^"']+)["'][^>]*alt=["'][^"']*${namePart}[^"']*["']`, 'i');
      
      const match = html.match(imgRegex) || 
                    html.match(/<img[^>]+id=["']cover_image["'][^>]+src=["']([^"']+)["']/i) ||
                    html.match(/<img[^>]+class=["']cover["'][^>]+src=["']([^"']+)["']/i);

      if (match && match[1]) {
        const imageUrl = match[1];
        
        // Update DB
        await db.update(cards)
          .set({ imageUrl: imageUrl, imageLargeUrl: imageUrl })
          .where(eq(cards.id, card.id));

        console.log(`[${i+1}/${targetCards.length}] ✅ Updated ${card.name} (${card.variant}): ${imageUrl}`);
        successCount++;
      } else {
        console.log(`[${i+1}/${targetCards.length}] ⚠️ No image found in HTML: ${url}`);
        failCount++;
      }
    } catch (err) {
      console.log(`[${i+1}/${targetCards.length}] ❌ Error scraping ${url}:`, err);
      failCount++;
    }

    // Rate limiting delay
    await delay(1500); 
  }

  console.log(`\n🎉 Scraping Complete! Successfully updated ${successCount} cards. Failed on ${failCount} cards.`);
  process.exit(0);
}

// Support a `--test` flag to just test 5 cards
if (process.argv.includes('--test')) {
    // Only process the first 5
    run();
} else {
    run();
}
