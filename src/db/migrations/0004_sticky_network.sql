ALTER TABLE "sales" ADD COLUMN "source" varchar(40);--> statement-breakpoint

-- Backfill provenance from the shape of the existing rows.
UPDATE "sales" SET "source" = 'ebay:browse-active'
  WHERE "ebay_url" LIKE '%ebay.com%';--> statement-breakpoint
UPDATE "sales" SET "source" = 'pricecharting:tcgplayer'
  WHERE "source" IS NULL AND "ebay_item_id" LIKE 'tcgplayer-%';--> statement-breakpoint
UPDATE "sales" SET "source" = 'pricecharting:ebay'
  WHERE "source" IS NULL AND "ebay_item_id" LIKE 'ebay-%';--> statement-breakpoint
UPDATE "sales" SET "source" = 'pricecharting:auction'
  WHERE "source" IS NULL;--> statement-breakpoint

-- Remove the eBay Browse API rows. The Browse API returns ACTIVE listings, so
-- these are asking prices with an itemEndDate standing in for a sale date --
-- they ran ~8% above genuine sold prices for the same card+condition. They are
-- not recoverable as sales, and PriceCharting data already covers all but 8 of
-- the 62 card+condition combos involved.
DELETE FROM "sales" WHERE "source" = 'ebay:browse-active';--> statement-breakpoint

CREATE INDEX "sales_source_idx" ON "sales" USING btree ("source");