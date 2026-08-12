CREATE TABLE "ebay_listing_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"payload" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "current_prices" ADD COLUMN "baseline_price" integer;--> statement-breakpoint
ALTER TABLE "current_prices" ADD COLUMN "baseline_source" varchar(50);--> statement-breakpoint
ALTER TABLE "current_prices" ADD COLUMN "price_source" varchar(20) DEFAULT 'baseline' NOT NULL;--> statement-breakpoint
ALTER TABLE "ebay_listing_cache" ADD CONSTRAINT "ebay_listing_cache_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_cache_card_idx" ON "ebay_listing_cache" USING btree ("card_id");--> statement-breakpoint
-- Data migration: every existing market_price was written by the PriceCharting
-- scraper (pc-scraper.ts) and pinned in place by price-updater.ts, so preserve
-- it as the baseline reference before the pricing engine starts overwriting
-- market_price with its own computed values.
UPDATE "current_prices" SET "baseline_price" = "market_price", "baseline_source" = 'pricecharting' WHERE "market_price" IS NOT NULL;