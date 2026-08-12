/**
 * API Route: GET /api/cron/scrape
 *
 * Vercel Cron endpoint that triggers the eBay scraper.
 * Runs every 15 minutes via Vercel Cron.
 *
 * Pipeline:
 * 1. Select top-priority cards not recently scraped
 * 2. Search eBay for sold listings
 * 3. Parse grades, insert sales (dedup by ebay_item_id)
 * 4. Run pricing engine on affected cards
 * 5. Update current_prices and price_snapshots
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 */

// vercel.json: { "crons": [{ "path": "/api/cron/scrape", "schedule": "0/15 * * * *" }] }

import { NextRequest } from 'next/server';
import { runScraperBatch } from '@/lib/ebay-scraper';
import { updatePricesForCards } from '@/lib/price-updater';
import {
  ebayInsightsSource,
  getInsightsAvailability,
} from '@/lib/sources/ebay-insights';

export const maxDuration = 60; // Vercel function timeout (seconds)

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel automatically adds this header for cron jobs).
  // Fail closed: an unset secret must not leave this endpoint publicly callable,
  // since each run costs eBay API quota and writes to the database.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[CRON] CRON_SECRET is not set — refusing to run.');
    return Response.json(
      { error: 'Cron endpoint is not configured' },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Check if eBay credentials are configured
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return Response.json({
      status: 'skipped',
      message: 'eBay credentials not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.',
    });
  }

  // Credentials alone are not enough. Sold data requires the Marketplace
  // Insights limited-release scope; without it the only eBay endpoint we could
  // call returns ACTIVE listings, and ingesting those as sales is what
  // contaminated the table before. Skip rather than write asking prices.
  if (!(await ebayInsightsSource.isAvailable())) {
    return Response.json({
      status: 'skipped',
      message:
        'eBay Marketplace Insights access has not been granted for this keyset, ' +
        'so no sold data is available. Pricing continues from PriceCharting. ' +
        'Run `npx tsx src/scripts/check-ebay-access.ts` for details.',
      detail: getInsightsAvailability().reason,
    });
  }

  try {
    const startTime = Date.now();

    // Step 1: Run scraper batch (50 cards per run)
    console.log('[CRON] Starting scraper batch...');
    const scraperStats = await runScraperBatch(30); // 30 cards to stay within timeout

    console.log(
      `[CRON] Scraper done: ${scraperStats.cardsProcessed} cards, ` +
      `${scraperStats.totalNewSales} new sales, ` +
      `${scraperStats.totalDuplicates} dupes, ` +
      `${scraperStats.totalErrors} errors`
    );

    // Step 2: Run pricing engine on cards that got new sales
    const cardsWithNewSales = scraperStats.results
      .filter((r) => r.newSalesInserted > 0)
      .map((r) => r.cardId);

    let priceStats = {
      combosUpdated: 0,
      pricesComputed: 0,
      snapshotsCreated: 0,
      outliersMarked: 0,
      duration_ms: 0,
    };

    if (cardsWithNewSales.length > 0) {
      console.log(`[CRON] Updating prices for ${cardsWithNewSales.length} cards...`);
      priceStats = await updatePricesForCards(cardsWithNewSales);
      console.log(
        `[CRON] Pricing done: ${priceStats.pricesComputed} prices computed, ` +
        `${priceStats.outliersMarked} outliers marked`
      );
    }

    const result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      scraper: {
        cards_processed: scraperStats.cardsProcessed,
        ebay_results: scraperStats.totalEbayResults,
        new_sales: scraperStats.totalNewSales,
        duplicates: scraperStats.totalDuplicates,
        errors: scraperStats.totalErrors,
      },
      pricing: {
        cards_updated: cardsWithNewSales.length,
        prices_computed: priceStats.pricesComputed,
        snapshots_created: priceStats.snapshotsCreated,
        outliers_marked: priceStats.outliersMarked,
      },
    };

    console.log('[CRON] Complete:', JSON.stringify(result));

    return Response.json(result);
  } catch (error: any) {
    console.error('[CRON] Scraper error:', error);
    return Response.json(
      {
        status: 'error',
        message: error.message || 'Scraper failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
