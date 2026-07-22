/**
 * Scraper Queue — Manages which cards to scrape and when
 *
 * This module implements a priority queue for the scraper:
 * - Cards that haven't been scraped recently get higher priority
 * - High-value cards (Charizard, etc.) get scraped more frequently
 * - Round-robin ensures every card gets updated within 24-48 hours
 *
 * Designed to work with Vercel Cron (runs every 15-30 minutes).
 */

export interface ScrapeJob {
  cardId: number;
  cardName: string;
  setName: string;
  cardNumber?: string;
  priority: number;
  lastScrapedAt: Date | null;
}

/**
 * Calculate the priority score for a card.
 *
 * Higher score = should be scraped sooner.
 *
 * Factors:
 * - Time since last scrape (exponential decay)
 * - Base priority from DB (popular cards have higher priority)
 * - Whether the card has any sales data yet
 */
export function calculatePriority(
  lastScrapedAt: Date | null,
  basePriority: number,
  hasSalesData: boolean
): number {
  let score = basePriority;

  if (!lastScrapedAt) {
    // Never scraped — very high priority
    score += 1000;
  } else {
    // Time-based priority: older scrapes get higher priority
    const hoursSinceLastScrape =
      (Date.now() - lastScrapedAt.getTime()) / (1000 * 60 * 60);

    // Exponential growth after 4 hours
    if (hoursSinceLastScrape > 4) {
      score += Math.min(500, Math.pow(hoursSinceLastScrape / 4, 2) * 10);
    }
  }

  // Cards without sales data need initial population
  if (!hasSalesData) {
    score += 200;
  }

  return score;
}

/**
 * Select the next batch of cards to scrape.
 *
 * @param jobs - All available scrape jobs
 * @param batchSize - Number of cards to scrape in this run (default: 50)
 * @returns Sorted batch of the highest-priority cards
 */
export function selectBatch(jobs: ScrapeJob[], batchSize: number = 50): ScrapeJob[] {
  // Sort by priority descending
  const sorted = [...jobs].sort((a, b) => b.priority - a.priority);

  return sorted.slice(0, batchSize);
}

/**
 * Estimate how long it will take to scrape a batch.
 *
 * @param batchSize - Number of cards in the batch
 * @param avgTimePerCardMs - Average scrape time per card (default: 5000ms)
 * @returns Estimated time in minutes
 */
export function estimateBatchTime(
  batchSize: number,
  avgTimePerCardMs: number = 5000
): number {
  return Math.ceil((batchSize * avgTimePerCardMs) / 60000);
}

// Create a Vercel Cron configuration for the scraper.
//
// Add this to vercel.json:
// {
//   "crons": [{
//     "path": "/api/cron/scrape",
//     "schedule": "every-15-minutes"
//   }]
// }
export const CRON_CONFIG = {
  path: '/api/cron/scrape',
  schedule: '*/15 * * * *', // Every 15 minutes
};
