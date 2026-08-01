CREATE TABLE "bot_leave_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"reason" text,
	"comment" text,
	"membership_ms" bigint,
	"staff_message_id" text,
	"left_at" timestamp DEFAULT now() NOT NULL,
	"answered_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "welcome_dm_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "welcome_dm_message" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "leave_survey_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "leave_feedback_channel_id" text;--> statement-breakpoint
CREATE INDEX "bot_leave_feedback_guild_idx" ON "bot_leave_feedback" USING btree ("guild_id","left_at" DESC NULLS LAST);