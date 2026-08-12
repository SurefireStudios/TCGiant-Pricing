CREATE TABLE "price_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"condition" "card_condition" NOT NULL,
	"source" varchar(40) NOT NULL,
	"price" integer,
	"low_price" integer,
	"mid_price" integer,
	"high_price" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"variant_key" varchar(40),
	"observed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_references" ADD CONSTRAINT "price_references_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_refs_card_cond_source_idx" ON "price_references" USING btree ("card_id","condition","source");--> statement-breakpoint
CREATE INDEX "price_refs_card_idx" ON "price_references" USING btree ("card_id");