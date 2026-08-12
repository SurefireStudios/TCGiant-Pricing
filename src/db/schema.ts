/**
 * Database Schema — Drizzle ORM schema for TCGiant Pricing
 *
 * Tables:
 * - games: TCG brands (Pokemon, YuGiOh, Magic, etc.)
 * - sets: Card sets within each game
 * - cards: Individual cards within sets
 * - sales: Raw eBay sold listing data
 * - price_snapshots: Computed prices (updated by pricing engine)
 * - api_keys: API authentication keys with tier-based rate limits
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  pgEnum,
  serial,
  index,
  uniqueIndex,
  varchar,
  date,
} from 'drizzle-orm/pg-core';

// --- Enums ---

export const gradingCompanyEnum = pgEnum('grading_company', [
  'UNGRADED',
  'PSA',
  'CGC',
  'BGS',
  'SGC',
  'TAG',
]);

export const cardConditionEnum = pgEnum('card_condition', [
  'UNGRADED',
  'GRADE_1',
  'GRADE_2',
  'GRADE_3',
  'GRADE_4',
  'GRADE_5',
  'GRADE_6',
  'GRADE_7',
  'GRADE_8',
  'GRADE_9',
  'GRADE_9_5',
  'PSA_10',
  'CGC_10',
  'BGS_10',
  'SGC_10',
  'TAG_10',
]);

export const cardVariantEnum = pgEnum('card_variant', [
  'unlimited',
  '1st_edition',
  'reverse_holo',
  'shadowless'
]);

export const apiTierEnum = pgEnum('api_tier', ['internal', 'free', 'basic', 'pro']);

export const snapshotPeriodEnum = pgEnum('snapshot_period', ['daily', 'weekly']);

// --- Tables ---

/**
 * Games — TCG brands/franchises
 * e.g., Pokemon, YuGiOh, Magic the Gathering, Dragon Ball Z, Lorcana, One Piece
 */
export const games = pgTable(
  'games',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('games_slug_idx').on(table.slug)]
);

/**
 * Sets — Card sets within a game
 * e.g., Base Set, Jungle, Fossil (Pokemon), Alpha, Beta (MTG)
 */
export const sets = pgTable(
  'sets',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    series: varchar('series', { length: 255 }),
    releaseDate: date('release_date'),
    totalCards: integer('total_cards'),
    printedTotal: integer('printed_total'),
    imageUrl: text('image_url'),
    symbolUrl: text('symbol_url'),
    externalId: varchar('external_id', { length: 100 }), // pokemontcg.io set ID
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sets_slug_idx').on(table.slug),
    index('sets_game_id_idx').on(table.gameId),
    index('sets_external_id_idx').on(table.externalId),
  ]
);

/**
 * Cards — Individual cards within a set
 */
export const cards = pgTable(
  'cards',
  {
    id: serial('id').primaryKey(),
    setId: integer('set_id')
      .notNull()
      .references(() => sets.id),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 500 }).notNull(),
    cardNumber: varchar('card_number', { length: 50 }),
    rarity: varchar('rarity', { length: 100 }),
    cardType: varchar('card_type', { length: 100 }), // Pokemon, Trainer, Energy, etc.
    supertype: varchar('supertype', { length: 100 }), // Pokémon, Trainer, Energy
    subtypes: text('subtypes'), // JSON array: ["Stage 2", "EX"]
    hp: varchar('hp', { length: 10 }),
    imageUrl: text('image_url'),
    imageLargeUrl: text('image_large_url'),
    externalId: varchar('external_id', { length: 100 }), // pokemontcg.io card ID
    artist: varchar('artist', { length: 255 }),
    variant: cardVariantEnum('variant').notNull().default('unlimited'),
    isActive: boolean('is_active').notNull().default(true),
    lastScrapedAt: timestamp('last_scraped_at'),
    scrapePreiority: integer('scrape_priority').notNull().default(0), // higher = scraped more often
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cards_slug_idx').on(table.slug),
    index('cards_set_id_idx').on(table.setId),
    index('cards_external_id_idx').on(table.externalId),
    index('cards_variant_idx').on(table.variant),
    index('cards_name_idx').on(table.name),
    index('cards_name_trgm_idx').using('gin', sql`name gin_trgm_ops`),
    index('cards_last_scraped_idx').on(table.lastScrapedAt),
  ]
);

/**
 * Sales — Raw eBay sold listing data
 * Each row represents a single sold listing from eBay.
 */
export const sales = pgTable(
  'sales',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    condition: cardConditionEnum('condition').notNull(),
    gradingCompany: gradingCompanyEnum('grading_company').notNull().default('UNGRADED'),
    gradeValue: decimal('grade_value', { precision: 3, scale: 1 }),
    salePrice: integer('sale_price').notNull(), // in cents
    saleDate: timestamp('sale_date').notNull(),
    // Not just eBay ids: PriceCharting rows carry auction-house identifiers
    // too ("goldin-2003-pokemon-skyridge-3-arcanine-psa-9719l7"), which blow
    // past any short varchar. The old per-row insert swallowed the resulting
    // 22001 errors, silently dropping those sales.
    ebayItemId: text('ebay_item_id'),
    ebayTitle: text('ebay_title'),
    ebayUrl: text('ebay_url'),
    /**
     * Where this row came from. Provenance matters because not every source is
     * a SOLD price: the eBay Browse API returns ACTIVE listings, and rows
     * ingested from it were asking prices masquerading as sales.
     *
     * Known values:
     *   pricecharting:ebay        — eBay sold row scraped from PriceCharting
     *   pricecharting:tcgplayer   — TCGplayer sold row scraped from PriceCharting
     *   pricecharting:auction     — Goldin/PWCC/etc auction row from PriceCharting
     *   ebay:insights             — eBay Marketplace Insights (genuine sold data)
     *   ebay:browse-active        — DEPRECATED. Active listings, NOT sales.
     */
    source: varchar('source', { length: 40 }),
    isOutlier: boolean('is_outlier').notNull().default(false),
    gradeConfidence: varchar('grade_confidence', { length: 10 }), // high, medium, low
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('sales_card_id_idx').on(table.cardId),
    index('sales_card_cond_idx').on(table.cardId, table.condition),
    index('sales_sale_date_idx').on(table.saleDate),
    uniqueIndex('sales_ebay_item_id_idx').on(table.ebayItemId),
    index('sales_is_outlier_idx').on(table.isOutlier),
  ]
);

/**
 * Price Snapshots — Computed prices for each card + condition
 * Updated by the pricing engine after each scraper run.
 */
export const priceSnapshots = pgTable(
  'price_snapshots',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    condition: cardConditionEnum('condition').notNull(),
    gradingCompany: gradingCompanyEnum('grading_company').notNull().default('UNGRADED'),
    marketPrice: integer('market_price'), // final blended price (cents)
    medianPrice: integer('median_price'),
    averagePrice: integer('average_price'),
    ewmaPrice: integer('ewma_price'),
    minPrice: integer('min_price'),
    maxPrice: integer('max_price'),
    saleCount: integer('sale_count').notNull().default(0),
    outlierCount: integer('outlier_count').notNull().default(0),
    period: snapshotPeriodEnum('period').notNull().default('daily'),
    snapshotDate: date('snapshot_date').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('price_snapshots_card_id_idx').on(table.cardId),
    index('price_snapshots_cond_idx').on(table.cardId, table.condition),
    index('price_snapshots_date_idx').on(table.snapshotDate),
    uniqueIndex('snapshots_card_condition_date_idx').on(
      table.cardId,
      table.condition,
      table.gradingCompany,
      table.snapshotDate,
      table.period
    ),
  ]
);

/**
 * Current Prices — The latest computed price for each card + condition.
 * This is the "live" pricing table that the API serves from.
 * Updated whenever a new snapshot is computed.
 */
export const currentPrices = pgTable(
  'current_prices',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    condition: cardConditionEnum('condition').notNull(),
    gradingCompany: gradingCompanyEnum('grading_company').notNull().default('UNGRADED'),
    marketPrice: integer('market_price'), // cents — OUR computed price (pricing-engine output)
    medianPrice: integer('median_price'),
    /**
     * Reference price scraped from an external source (currently PriceCharting).
     * Kept separate from marketPrice so we can measure how far our own pricing
     * diverges from theirs, and so we can fall back to it when we lack samples.
     * Never let this overwrite marketPrice — see lib/price-updater.ts.
     */
    baselinePrice: integer('baseline_price'),
    baselineSource: varchar('baseline_source', { length: 50 }),
    /** Where marketPrice came from: 'computed' (our engine) or 'baseline' (fallback) */
    priceSource: varchar('price_source', { length: 20 }).notNull().default('baseline'),
    saleCount: integer('sale_count').notNull().default(0),
    volumeText: varchar('volume_text', { length: 100 }),
    lastSaleDate: timestamp('last_sale_date'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('current_prices_card_cond_idx').on(
      table.cardId,
      table.condition,
      table.gradingCompany
    ),
    index('current_prices_card_idx').on(table.cardId),
  ]
);

/**
 * Price References — third-party prices for the same card, kept side by side.
 *
 * `current_prices.baseline_price` holds a single external figure and is owned
 * by the PriceCharting scraper. That is not enough: a single reference cannot
 * be checked against anything, so when it is wrong we have no way to know.
 * PriceCharting lists Legendary Collection Dark Blastoise #4 at $6,714 for
 * PSA 10 against $275 for Grade 9.5 — 958 cards show that same implausibility —
 * and nothing in the data flags it.
 *
 * With several references we can measure disagreement, which is both a quality
 * signal for us and a genuine differentiator: no competitor shows you where the
 * price guides disagree.
 *
 * One row per card + condition + source.
 */
export const priceReferences = pgTable(
  'price_references',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    condition: cardConditionEnum('condition').notNull(),
    /** 'tcgplayer' | 'cardmarket' | 'pricecharting' */
    source: varchar('source', { length: 40 }).notNull(),
    /** The headline figure for this source, in cents. */
    price: integer('price'),
    lowPrice: integer('low_price'),
    midPrice: integer('mid_price'),
    highPrice: integer('high_price'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    /** Which sub-price we read, e.g. 'holofoil' or 'reverseHolofoil'. */
    variantKey: varchar('variant_key', { length: 40 }),
    /** When the SOURCE says it was updated, not when we fetched it. */
    observedAt: timestamp('observed_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('price_refs_card_cond_source_idx').on(
      table.cardId,
      table.condition,
      table.source
    ),
    index('price_refs_card_idx').on(table.cardId),
  ]
);

/**
 * eBay Listing Cache — Cached responses for the public live-listings widget.
 *
 * /api/v1/ebay/active is browser-facing and cannot require an API key, so
 * without a shared cache anyone could loop it and burn the daily eBay Browse
 * quota (5,000 calls/day). Serverless instances don't share memory, so the
 * cache has to live here.
 */
export const ebayListingCache = pgTable(
  'ebay_listing_cache',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    payload: text('payload').notNull(), // JSON-encoded EbaySoldItem[]
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ebay_listing_cache_card_idx').on(table.cardId)]
);

/**
 * API Keys — Authentication for the REST API
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(), // SHA-256 hash
    keyPrefix: varchar('key_prefix', { length: 8 }).notNull(), // first 8 chars for identification
    userEmail: varchar('user_email', { length: 255 }),
    userName: varchar('user_name', { length: 255 }),
    tier: apiTierEnum('tier').notNull().default('free'),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(10),
    rateLimitPerDay: integer('rate_limit_per_day').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    requestCount: integer('request_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    index('api_keys_prefix_idx').on(table.keyPrefix),
  ]
);

/**
 * API Usage — durable rate-limit counters.
 *
 * Rate limiting previously lived in an in-process Map, which enforces nothing
 * in production: every serverless instance keeps its own copy and each cold
 * start resets it. Counters have to be shared, so they live here.
 *
 * One row per key per window. Incrementing is a single upsert that returns the
 * new count, so a request costs one extra round trip against a database it is
 * already talking to.
 */
export const apiUsage = pgTable(
  'api_usage',
  {
    id: serial('id').primaryKey(),
    apiKeyId: integer('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    /** 'minute' or 'day' — both limits are enforced. */
    windowKind: varchar('window_kind', { length: 10 }).notNull(),
    /** Start of the window, truncated to windowKind. */
    windowStart: timestamp('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('api_usage_window_idx').on(
      table.apiKeyId,
      table.windowKind,
      table.windowStart
    ),
    // Supports pruning expired windows.
    index('api_usage_start_idx').on(table.windowStart),
  ]
);

// ===========================================================================
// TCG catalogue, re-founded on TCGplayer identity (sourced via tcgcsv.com)
// ===========================================================================
//
// The original games/sets/cards model derived identity from pokemontcg.io and
// then tried to reconstruct every other source's identity with string
// manipulation. Every serious bug this project hit was a consequence: reverse
// holo sales priced as unlimited, "TG30" mangled into "-30", apostrophes
// dropped from slugs, promos filed under the wrong console, grading companies
// splitting one price into five thin rows.
//
// TCGplayer already publishes the identity we were trying to infer:
//   category  →  the game            (Pokemon, Lorcana, One Piece, YuGiOh …)
//   group     →  the printing run    ("Base Set", "Base Set (Shadowless)",
//                                     "Base Set (1st Edition)" are SEPARATE)
//   product   →  the card
//   subType   →  the finish          (Normal / Holofoil / Reverse Holofoil …)
//
// So we adopt it rather than map to it. tcgcsv.com mirrors the whole thing
// daily, free, no key: ~2,900 requests covers Pokemon, Pokemon Japan, Lorcana,
// One Piece and YuGiOh together, at ~30ms each.
//
// Scope note: these are RAW marketplace prices. Graded (PSA/CGC/BGS) pricing is
// a separate problem and is not served by this source.

/** A game. Mirrors a TCGplayer category. */
export const tcgCategories = pgTable(
  'tcg_categories',
  {
    /** TCGplayer categoryId — 3 = Pokemon, 71 = Lorcana, 68 = One Piece. */
    id: integer('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    /** Only enabled games are ingested and shown. */
    isEnabled: boolean('is_enabled').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tcg_categories_slug_idx').on(table.slug)]
);

/** A set / printing run. Mirrors a TCGplayer group. */
export const tcgGroups = pgTable(
  'tcg_groups',
  {
    /** TCGplayer groupId. */
    id: integer('id').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => tcgCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 300 }).notNull(),
    abbreviation: varchar('abbreviation', { length: 50 }),
    publishedOn: date('published_on'),
    /** Last time we pulled products+prices for this group. */
    syncedAt: timestamp('synced_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tcg_groups_slug_idx').on(table.slug),
    index('tcg_groups_category_idx').on(table.categoryId),
    index('tcg_groups_synced_idx').on(table.syncedAt),
  ]
);

/** A card. Mirrors a TCGplayer product. */
export const tcgProducts = pgTable(
  'tcg_products',
  {
    /** TCGplayer productId — stable, authoritative, cross-source joinable. */
    id: integer('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => tcgGroups.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    cleanName: varchar('clean_name', { length: 500 }),
    slug: varchar('slug', { length: 600 }).notNull(),
    /** Printed collector number, lifted out of TCGplayer's extendedData. */
    number: varchar('number', { length: 50 }),
    rarity: varchar('rarity', { length: 100 }),
    imageUrl: text('image_url'),
    /** TCGplayer's own product page — a real link, not a competitor's. */
    sourceUrl: text('source_url'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tcg_products_slug_idx').on(table.slug),
    index('tcg_products_group_idx').on(table.groupId),
    index('tcg_products_category_idx').on(table.categoryId),
    index('tcg_products_name_trgm_idx').using('gin', sql`name gin_trgm_ops`),
  ]
);

/**
 * Daily price snapshot, one row per product + finish + day.
 *
 * This is the price history, recorded natively rather than reconstructed. The
 * previous attempt backdated a single computed value across every historical
 * date, which fabricated the chart; here each row is simply what the market
 * said on the day we asked, and is never rewritten.
 *
 * tcgcsv has no public archive, so history starts the day ingestion starts.
 */
export const tcgPrices = pgTable(
  'tcg_prices',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => tcgProducts.id, { onDelete: 'cascade' }),
    /** "Normal", "Holofoil", "Reverse Holofoil", "1st Edition Holofoil", … */
    subType: varchar('sub_type', { length: 60 }).notNull(),
    asOf: date('as_of').notNull(),
    /** All cents. marketPrice is TCGplayer's headline figure. */
    marketPrice: integer('market_price'),
    lowPrice: integer('low_price'),
    midPrice: integer('mid_price'),
    highPrice: integer('high_price'),
    directLowPrice: integer('direct_low_price'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tcg_prices_unique_idx').on(table.productId, table.subType, table.asOf),
    index('tcg_prices_product_idx').on(table.productId),
    index('tcg_prices_as_of_idx').on(table.asOf),
  ]
);

/**
 * The latest price per product + finish — what the site reads.
 *
 * Denormalised on purpose: one indexed lookup per page instead of a
 * max(as_of) subquery. Rebuilt from tcg_prices, never hand-edited, single
 * writer. The old current_prices had four writers and drifted from its own
 * source data.
 */
export const tcgLatestPrices = pgTable(
  'tcg_latest_prices',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => tcgProducts.id, { onDelete: 'cascade' }),
    subType: varchar('sub_type', { length: 60 }).notNull(),
    asOf: date('as_of').notNull(),
    marketPrice: integer('market_price'),
    lowPrice: integer('low_price'),
    midPrice: integer('mid_price'),
    highPrice: integer('high_price'),
    /** Change vs the same figure 7 and 30 days ago, in cents. Null until we have history. */
    change7d: integer('change_7d'),
    change30d: integer('change_30d'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tcg_latest_unique_idx').on(table.productId, table.subType),
    index('tcg_latest_product_idx').on(table.productId),
  ]
);

// --- Type Exports ---

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type Set = typeof sets.$inferSelect;
export type NewSet = typeof sets.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type SaleRecord = typeof sales.$inferSelect;
export type NewSaleRecord = typeof sales.$inferInsert;
export type PriceSnapshotRecord = typeof priceSnapshots.$inferSelect;
export type CurrentPrice = typeof currentPrices.$inferSelect;
export type EbayListingCache = typeof ebayListingCache.$inferSelect;
export type PriceReference = typeof priceReferences.$inferSelect;
export type TcgCategory = typeof tcgCategories.$inferSelect;
export type TcgGroup = typeof tcgGroups.$inferSelect;
export type TcgProduct = typeof tcgProducts.$inferSelect;
export type TcgPrice = typeof tcgPrices.$inferSelect;
export type TcgLatestPrice = typeof tcgLatestPrices.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;
