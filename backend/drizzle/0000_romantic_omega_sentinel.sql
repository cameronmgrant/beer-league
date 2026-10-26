CREATE TABLE "beer_posts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "beer_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"image_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"caption" text,
	"consumed_at" timestamp with time zone NOT NULL,
	"time_source" text NOT NULL,
	"time_zone" text NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "caption_length" CHECK (char_length("beer_posts"."caption") <= 140),
	CONSTRAINT "time_source_valid" CHECK ("beer_posts"."time_source" IN ('exif', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "daily_counts" (
	"user_id" bigint NOT NULL,
	"local_date" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "daily_counts_user_id_local_date_pk" PRIMARY KEY("user_id","local_date"),
	CONSTRAINT "count_non_negative" CHECK ("daily_counts"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" bigint,
	"used_by" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "beer_posts" ADD CONSTRAINT "beer_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_counts" ADD CONSTRAINT "daily_counts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beer_posts_feed_idx" ON "beer_posts" USING btree ("created_at","id") WHERE "beer_posts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "beer_posts_user_date_idx" ON "beer_posts" USING btree ("user_id","local_date");