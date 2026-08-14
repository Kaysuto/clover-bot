ALTER TABLE "bot_applications" ADD COLUMN "application_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_applications" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_category_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_role_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_counter" integer DEFAULT 0 NOT NULL;