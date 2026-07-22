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
    ebayItemId: varchar('ebay_item_id', { length: 50 }),
    ebayTitle: text('ebay_title'),
    ebayUrl: text('ebay_url'),
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
    marketPrice: integer('market_price'), // cents
    medianPrice: integer('median_price'),
    saleCount: integer('sale_count').notNull().default(0),
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
export type ApiKey = typeof apiKeys.$inferSelect;
