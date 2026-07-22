CREATE TYPE "public"."api_tier" AS ENUM('internal', 'free', 'basic', 'pro');--> statement-breakpoint
CREATE TYPE "public"."card_condition" AS ENUM('UNGRADED', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6', 'GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_9_5', 'PSA_10', 'CGC_10', 'BGS_10', 'TAG_10');--> statement-breakpoint
CREATE TYPE "public"."card_variant" AS ENUM('unlimited', '1st_edition', 'reverse_holo', 'shadowless');--> statement-breakpoint
CREATE TYPE "public"."grading_company" AS ENUM('UNGRADED', 'PSA', 'CGC', 'BGS', 'TAG');--> statement-breakpoint
CREATE TYPE "public"."snapshot_period" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(8) NOT NULL,
	"user_email" varchar(255),
	"user_name" varchar(255),
	"tier" "api_tier" DEFAULT 'free' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 10 NOT NULL,
	"rate_limit_per_day" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"card_number" varchar(50),
	"rarity" varchar(100),
	"card_type" varchar(100),
	"supertype" varchar(100),
	"subtypes" text,
	"hp" varchar(10),
	"image_url" text,
	"image_large_url" text,
	"external_id" varchar(100),
	"artist" varchar(255),
	"variant" "card_variant" DEFAULT 'unlimited' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp,
	"scrape_priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "current_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"condition" "card_condition" NOT NULL,
	"grading_company" "grading_company" DEFAULT 'UNGRADED' NOT NULL,
	"market_price" integer,
	"median_price" integer,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"volume_text" varchar(100),
	"last_sale_date" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"condition" "card_condition" NOT NULL,
	"grading_company" "grading_company" DEFAULT 'UNGRADED' NOT NULL,
	"market_price" integer,
	"median_price" integer,
	"average_price" integer,
	"ewma_price" integer,
	"min_price" integer,
	"max_price" integer,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"outlier_count" integer DEFAULT 0 NOT NULL,
	"period" "snapshot_period" DEFAULT 'daily' NOT NULL,
	"snapshot_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"condition" "card_condition" NOT NULL,
	"grading_company" "grading_company" DEFAULT 'UNGRADED' NOT NULL,
	"grade_value" numeric(3, 1),
	"sale_price" integer NOT NULL,
	"sale_date" timestamp NOT NULL,
	"ebay_item_id" varchar(50),
	"ebay_title" text,
	"ebay_url" text,
	"is_outlier" boolean DEFAULT false NOT NULL,
	"grade_confidence" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"series" varchar(255),
	"release_date" date,
	"total_cards" integer,
	"printed_total" integer,
	"image_url" text,
	"symbol_url" text,
	"external_id" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_prices" ADD CONSTRAINT "current_prices_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_slug_idx" ON "cards" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cards_set_id_idx" ON "cards" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "cards_external_id_idx" ON "cards" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "cards_variant_idx" ON "cards" USING btree ("variant");--> statement-breakpoint
CREATE INDEX "cards_name_idx" ON "cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cards_name_trgm_idx" ON "cards" USING gin (name gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_last_scraped_idx" ON "cards" USING btree ("last_scraped_at");--> statement-breakpoint
CREATE UNIQUE INDEX "current_prices_card_cond_idx" ON "current_prices" USING btree ("card_id","condition","grading_company");--> statement-breakpoint
CREATE INDEX "current_prices_card_idx" ON "current_prices" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_slug_idx" ON "games" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "price_snapshots_card_id_idx" ON "price_snapshots" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_cond_idx" ON "price_snapshots" USING btree ("card_id","condition");--> statement-breakpoint
CREATE INDEX "price_snapshots_date_idx" ON "price_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_card_condition_date_idx" ON "price_snapshots" USING btree ("card_id","condition","grading_company","snapshot_date","period");--> statement-breakpoint
CREATE INDEX "sales_card_id_idx" ON "sales" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "sales_card_cond_idx" ON "sales" USING btree ("card_id","condition");--> statement-breakpoint
CREATE INDEX "sales_sale_date_idx" ON "sales" USING btree ("sale_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ebay_item_id_idx" ON "sales" USING btree ("ebay_item_id");--> statement-breakpoint
CREATE INDEX "sales_is_outlier_idx" ON "sales" USING btree ("is_outlier");--> statement-breakpoint
CREATE UNIQUE INDEX "sets_slug_idx" ON "sets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sets_game_id_idx" ON "sets" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "sets_external_id_idx" ON "sets" USING btree ("external_id");