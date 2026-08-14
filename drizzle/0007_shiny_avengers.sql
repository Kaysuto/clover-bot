CREATE TABLE "bot_invite_tier_grants" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"threshold" integer NOT NULL,
	"credits" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_invite_tier_grants_guild_id_user_id_threshold_pk" PRIMARY KEY("guild_id","user_id","threshold")
);
--> statement-breakpoint
CREATE TABLE "bot_invite_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"threshold" integer NOT NULL,
	"credits" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_xp" integer DEFAULT 250 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_maturity_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_min_account_age_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_require_link" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_min_level" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "invite_monthly_cap" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_invite_joins" ADD COLUMN "reward_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_invite_joins" ADD COLUMN "reward_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_invite_joins" ADD COLUMN "reward_reason" text;--> statement-breakpoint
ALTER TABLE "bot_invite_joins" ADD COLUMN "credits_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_invite_joins" ADD COLUMN "xp_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_invite_tiers_guild_threshold_idx" ON "bot_invite_tiers" USING btree ("guild_id","threshold");--> statement-breakpoint
CREATE INDEX "bot_invite_joins_reward_idx" ON "bot_invite_joins" USING btree ("reward_status","joined_at");