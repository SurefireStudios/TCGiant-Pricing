/**
 * Pricing Engine — Combines eBay sales data into market prices
 *
 * This module implements the pricing algorithm that:
 * 1. Detects and flags outlier sales (IQR method)
 * 2. Calculates market price using a weighted blend of:
 *    - EWMA (Exponentially Weighted Moving Average) — 40% weight
 *    - Median price — 35% weight
 *    - Recent sale average (last 5 sales) — 25% weight
 * 3. Applies age weighting to favor recent sales
 * 4. Requires minimum sample sizes for confidence
 *
 * All prices are stored as integers (cents) to avoid floating-point issues.
 */

export interface Sale {
  id: string;
  price: number; // in cents
  saleDate: Date;
  isOutlier?: boolean;
}

export interface PriceSnapshot {
  marketPrice: number; // final blended price (cents)
  medianPrice: number;
  averagePrice: number;
  ewmaPrice: number;
  minPrice: number;
  maxPrice: number;
  saleCount: number;
  outlierCount: number;
}

// --- Configuration ---

/** EWMA smoothing factor. Higher = more weight on recent sales */
const EWMA_ALPHA = 0.3;

/** IQR multiplier for outlier detection. Higher = less aggressive filtering */
const IQR_MULTIPLIER = 2.0;

/** Minimum non-outlier sales required to compute a price */
const MIN_SAMPLE_SIZE = 3;

/** Maximum number of sales to consider for price calculation */
const MAX_SALES_WINDOW = 50;

/** Weight blend for final market price */
const WEIGHT_EWMA = 0.40;
const WEIGHT_MEDIAN = 0.35;
const WEIGHT_RECENT = 0.25;

/** Age weight brackets (days → weight) */
const AGE_WEIGHTS: { maxDays: number; weight: number }[] = [
  { maxDays: 7, weight: 1.0 },
  { maxDays: 30, weight: 0.7 },
  { maxDays: 90, weight: 0.4 },
  { maxDays: Infinity, weight: 0.1 },
];

/** Number of recent sales for the "recent average" component */
const RECENT_SALES_COUNT = 5;

// --- Core Functions ---

/**
 * Detect outlier sales using the IQR (Interquartile Range) method.
 *
 * Sales with prices below Q1 - 2×IQR or above Q3 + 2×IQR are flagged.
 * This catches both suspiciously low sales (damaged items, lots, errors)
 * and suspiciously high sales (bidding wars, shill bidding, errors).
 *
 * @param sales - Array of sale prices (cents)
 * @returns Set of indices that are outliers
 */
export function detectOutliers(prices: number[]): Set<number> {
  const outliers = new Set<number>();

  if (prices.length < 4) {
    // Not enough data for meaningful IQR
    return outliers;
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  const lowerBound = q1 - IQR_MULTIPLIER * iqr;
  const upperBound = q3 + IQR_MULTIPLIER * iqr;

  for (let i = 0; i < prices.length; i++) {
    if (prices[i] < lowerBound || prices[i] > upperBound) {
      outliers.add(i);
    }
  }

  return outliers;
}

/**
 * Calculate the median of a sorted array of numbers.
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/**
 * Calculate the age-weighted average price.
 *
 * More recent sales are given higher weight. This ensures the price
 * reflects current market conditions rather than being dragged by
 * old sales from months ago.
 *
 * @param sales - Sales with dates, sorted by date descending (newest first)
 * @returns Age-weighted average price in cents
 */
export function calculateAgeWeightedAverage(sales: Sale[]): number {
  if (sales.length === 0) return 0;

  const now = new Date();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const sale of sales) {
    const daysSinceSale = Math.floor(
      (now.getTime() - sale.saleDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Find the appropriate age weight
    const ageWeight =
      AGE_WEIGHTS.find((w) => daysSinceSale <= w.maxDays)?.weight ?? 0.1;

    weightedSum += sale.price * ageWeight;
    totalWeight += ageWeight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

/**
 * Calculate the Exponentially Weighted Moving Average (EWMA).
 *
 * EWMA naturally gives more weight to recent observations, making it
 * responsive to price trends while smoothing out noise.
 *
 * Formula: EWMA_t = α × Price_t + (1 - α) × EWMA_{t-1}
 *
 * @param prices - Prices in chronological order (oldest first)
 * @param alpha - Smoothing factor (0 < α ≤ 1). Default: 0.3
 * @returns EWMA price in cents
 */
export function calculateEWMA(prices: number[], alpha: number = EWMA_ALPHA): number {
  if (prices.length === 0) return 0;

  let ewma = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ewma = alpha * prices[i] + (1 - alpha) * ewma;
  }

  return Math.round(ewma);
}

/**
 * Calculate the simple average of recent sales.
 *
 * @param prices - Prices sorted by date (newest first)
 * @param count - Number of recent sales to average
 * @returns Average price in cents
 */
export function calculateRecentAverage(
  prices: number[],
  count: number = RECENT_SALES_COUNT
): number {
  if (prices.length === 0) return 0;

  const recent = prices.slice(0, Math.min(count, prices.length));
  const sum = recent.reduce((acc, p) => acc + p, 0);
  return Math.round(sum / recent.length);
}

/**
 * Main pricing function — computes a full PriceSnapshot for a set of sales.
 *
 * This is the core algorithm that should be called for each card+condition
 * combination after new sales data is ingested.
 *
 * @param sales - All sales for a card in a specific condition, sorted by date descending
 * @returns PriceSnapshot with market price and component metrics, or null if insufficient data
 */
export function computePrice(sales: Sale[]): PriceSnapshot | null {
  if (sales.length === 0) return null;

  // Limit to the most recent sales window
  const recentSales = sales.slice(0, MAX_SALES_WINDOW);

  // Step 1: Detect outliers
  const prices = recentSales.map((s) => s.price);
  const outlierIndices = detectOutliers(prices);

  // Step 2: Filter out outliers for price calculation
  const cleanSales = recentSales.filter((_, i) => !outlierIndices.has(i));
  const cleanPrices = cleanSales.map((s) => s.price);

  if (cleanPrices.length < MIN_SAMPLE_SIZE) {
    // Not enough non-outlier data
    // Still return what we have, but mark it
    if (prices.length > 0) {
      const median = calculateMedian(prices);
      return {
        marketPrice: median,
        medianPrice: median,
        averagePrice: Math.round(
          prices.reduce((a, b) => a + b, 0) / prices.length
        ),
        ewmaPrice: median,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        saleCount: prices.length,
        outlierCount: outlierIndices.size,
      };
    }
    return null;
  }

  // Step 3: Calculate component prices
  const medianPrice = calculateMedian(cleanPrices);

  const ageWeightedAvg = calculateAgeWeightedAverage(cleanSales);

  // For EWMA, we need chronological order (oldest first)
  const chronologicalPrices = [...cleanPrices].reverse();
  const ewmaPrice = calculateEWMA(chronologicalPrices);

  // Recent average (newest first — cleanPrices already in this order)
  const recentAvg = calculateRecentAverage(cleanPrices);

  // Step 4: Blend into market price
  const marketPrice = Math.round(
    WEIGHT_EWMA * ewmaPrice +
      WEIGHT_MEDIAN * medianPrice +
      WEIGHT_RECENT * recentAvg
  );

  // Step 5: Calculate min/max (from clean data)
  const minPrice = Math.min(...cleanPrices);
  const maxPrice = Math.max(...cleanPrices);

  // Step 6: Simple average
  const averagePrice = Math.round(
    cleanPrices.reduce((a, b) => a + b, 0) / cleanPrices.length
  );

  return {
    marketPrice,
    medianPrice,
    averagePrice,
    ewmaPrice,
    minPrice,
    maxPrice,
    saleCount: recentSales.length,
    outlierCount: outlierIndices.size,
  };
}

/**
 * Mark outliers in a list of sales.
 * Returns the sales with `isOutlier` field set.
 *
 * Used by the scraper pipeline to flag outliers in the database
 * without removing them.
 */
export function markOutliers(sales: Sale[]): Sale[] {
  const prices = sales.map((s) => s.price);
  const outlierIndices = detectOutliers(prices);

  return sales.map((sale, i) => ({
    ...sale,
    isOutlier: outlierIndices.has(i),
  }));
}

/**
 * Format a price in cents to a display string.
 * @example formatPrice(32500) → "$325.00"
 */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse a price string to cents.
 * @example parsePriceToCents("$325.00") → 32500
 * @example parsePriceToCents("325.00") → 32500
 * @example parsePriceToCents("$1,234.56") → 123456
 */
export function parsePriceToCents(priceStr: string): number {
  const cleaned = priceStr.replace(/[$,\s]/g, '');
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}
