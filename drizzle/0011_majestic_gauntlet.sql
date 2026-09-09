ALTER TABLE "bot_guild_config" ADD COLUMN "game_event_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "game_sanction_inbound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_join_threshold" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_window_sec" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_lockdown_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_previous_verification" integer;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_pause_invites" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_alert_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_min_account_age_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_quarantine_role_id" text;