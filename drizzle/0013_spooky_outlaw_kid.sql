CREATE TABLE "bot_dashboard_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_dashboard_daily" (
	"guild_id" text NOT NULL,
	"day" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"members" integer,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_dashboard_daily_guild_day" ON "bot_dashboard_daily" USING btree ("guild_id","day");