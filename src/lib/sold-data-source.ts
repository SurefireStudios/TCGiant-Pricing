/**
 * Sold-data source abstraction.
 *
 * Today every sale in the database is scraped from PriceCharting. That is a
 * bootstrap, not a business: our prices can never be better than theirs, we
 * inherit their errors with no independent signal to detect them, and our
 * refresh rate is capped by their rate limiter (~1 req/s).
 *
 * The goal is to swap PriceCharting for our own eBay sold-data feed without
 * rewriting the ingest pipeline. Both sources therefore implement one
 * interface, and the pipeline is written against the interface.
 *
 * IMPORTANT — the eBay API landscape:
 *   - Browse API (`item_summary/search`) returns ACTIVE listings only. There is
 *     no sold filter. Rows previously ingested from it were asking prices and
 *     have been deleted; see `sales.source = 'ebay:browse-active'`.
 *   - Finding API `findCompletedItems` was decommissioned in February 2025.
 *   - Marketplace Insights API is the ONLY official sold-data source. It is a
 *     Limited Release product: a standard developer keyset returns
 *     `invalid_scope` until eBay approves access for that keyset.
 */

export type SoldDataSourceId =
  | 'pricecharting'
  | 'ebay:insights';

/** One observed transaction. Prices are integer cents, never floats. */
export interface SoldSale {
  /** Stable id used for deduplication. Must be unique per source. */
  externalId: string;
  title: string;
  /** Cents. */
  price: number;
  currency: string;
  /** When the item actually SOLD — never a listing end date for an active item. */
  soldDate: Date;
  url: string | null;
  /** Provenance written to `sales.source`. */
  source: string;
}

export interface SoldQuery {
  cardName: string;
  setName: string;
  cardNumber: string | null;
  /** Card variant, used to keep 1st-edition sales off unlimited cards. */
  variant: string;
  limit?: number;
}

export interface SoldDataSource {
  readonly id: SoldDataSourceId;
  /** Human-readable, for logs and the admin surface. */
  readonly label: string;
  /**
   * Whether this source can actually be used right now. Marketplace Insights
   * reports false until eBay grants the limited-release scope, which lets the
   * pipeline fall back rather than fail.
   */
  isAvailable(): Promise<boolean>;
  fetchSales(query: SoldQuery): Promise<SoldSale[]>;
}

/**
 * Pick the best available source, most-preferred first.
 *
 * Once Marketplace Insights is approved this returns eBay, and PriceCharting
 * becomes a cross-check rather than the source of truth.
 */
export async function selectSource(
  candidates: SoldDataSource[]
): Promise<SoldDataSource | null> {
  for (const source of candidates) {
    if (await source.isAvailable()) return source;
  }
  return null;
}
