CREATE TABLE "tcg_categories" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_groups" (
	"id" integer PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(300) NOT NULL,
	"abbreviation" varchar(50),
	"published_on" date,
	"synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_latest_prices" (
	"product_id" integer NOT NULL,
	"sub_type" varchar(60) NOT NULL,
	"as_of" date NOT NULL,
	"market_price" integer,
	"low_price" integer,
	"mid_price" integer,
	"high_price" integer,
	"change_7d" integer,
	"change_30d" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sub_type" varchar(60) NOT NULL,
	"as_of" date NOT NULL,
	"market_price" integer,
	"low_price" integer,
	"mid_price" integer,
	"high_price" integer,
	"direct_low_price" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcg_products" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"name" varchar(500) NOT NULL,
	"clean_name" varchar(500),
	"slug" varchar(600) NOT NULL,
	"number" varchar(50),
	"rarity" varchar(100),
	"image_url" text,
	"source_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tcg_groups" ADD CONSTRAINT "tcg_groups_category_id_tcg_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."tcg_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_latest_prices" ADD CONSTRAINT "tcg_latest_prices_product_id_tcg_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tcg_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_prices" ADD CONSTRAINT "tcg_prices_product_id_tcg_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tcg_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_products" ADD CONSTRAINT "tcg_products_group_id_tcg_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tcg_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_categories_slug_idx" ON "tcg_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_groups_slug_idx" ON "tcg_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tcg_groups_category_idx" ON "tcg_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tcg_groups_synced_idx" ON "tcg_groups" USING btree ("synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_latest_unique_idx" ON "tcg_latest_prices" USING btree ("product_id","sub_type");--> statement-breakpoint
CREATE INDEX "tcg_latest_product_idx" ON "tcg_latest_prices" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_prices_unique_idx" ON "tcg_prices" USING btree ("product_id","sub_type","as_of");--> statement-breakpoint
CREATE INDEX "tcg_prices_product_idx" ON "tcg_prices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "tcg_prices_as_of_idx" ON "tcg_prices" USING btree ("as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tcg_products_slug_idx" ON "tcg_products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tcg_products_group_idx" ON "tcg_products" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "tcg_products_category_idx" ON "tcg_products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tcg_products_name_trgm_idx" ON "tcg_products" USING gin (name gin_trgm_ops);