CREATE TABLE "api_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"window_kind" varchar(10) NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_window_idx" ON "api_usage" USING btree ("api_key_id","window_kind","window_start");--> statement-breakpoint
CREATE INDEX "api_usage_start_idx" ON "api_usage" USING btree ("window_start");