CREATE TABLE "bot_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text,
	"label" text,
	"data" jsonb NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_bot_quarantine" (
	"guild_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"role_id" text,
	"permissions" text DEFAULT '0' NOT NULL,
	"added_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_bot_quarantine_guild_id_bot_id_pk" PRIMARY KEY("guild_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE "bot_network_guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"network_id" integer NOT NULL,
	"share_bans" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_networks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"join_code" text,
	"join_code_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_restore_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"backup_id" integer NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"id_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_security_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"target_id" text,
	"summary" text NOT NULL,
	"measures" text[] DEFAULT '{}'::text[] NOT NULL,
	"restore" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_security_trusted" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_security_trusted_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bot_ticket_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_verifications" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"kick_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_verifications_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bot_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "security_role_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "security_alert_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "raid_lockdown_min_age_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nuke_delete_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nuke_ban_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nuke_create_threshold" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nuke_window_sec" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nuke_restore" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "backup_interval_hours" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "backup_messages_per_channel" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "backup_retention" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_max_messages" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_window_sec" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_max_mentions" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_max_chars" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_max_lines" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_duplicate_accounts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_timeout_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "spam_exempt_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "phishing_timeout_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "phishing_allow_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_role_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_message_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_mode" text DEFAULT 'bouton' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_state" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "verify_kick_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nsfw_threshold" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "nsfw_images" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "staff_min_account_age_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "staff_min_member_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "impersonation_quarantine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "network_log_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "outbound_webhook_url" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "outbound_webhook_secret" text;--> statement-breakpoint
CREATE INDEX "bot_backups_guild_idx" ON "bot_backups" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_security_incidents_guild_idx" ON "bot_security_incidents" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_ticket_notes_ticket_idx" ON "bot_ticket_notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "bot_webhook_deliveries_due_idx" ON "bot_webhook_deliveries" USING btree ("delivered_at","next_attempt_at");--> statement-breakpoint
-- Journal en 13 catégories : les salons, rôles et invitations quittent « serveur », les profils quittent « membres ». Chaque nouvelle catégorie hérite du réglage (salon, activation) de celle dont elle sort.
INSERT INTO "bot_log_settings" ("guild_id", "category", "channel_id", "enabled") SELECT "guild_id", c.category, "channel_id", "enabled" FROM "bot_log_settings", (VALUES ('salons'), ('roles'), ('invitations')) AS c(category) WHERE "bot_log_settings"."category" = 'serveur' ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "bot_log_settings" ("guild_id", "category", "channel_id", "enabled") SELECT "guild_id", 'profils', "channel_id", "enabled" FROM "bot_log_settings" WHERE "category" = 'membres' ON CONFLICT DO NOTHING;
