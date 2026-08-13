CREATE TABLE "bot_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" text NOT NULL,
	"answers" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"message_id" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_rank_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"lp_group" text NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_sanctions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"moderator_id" text NOT NULL,
	"type" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"minecraft_username" text
);
--> statement-breakpoint
CREATE TABLE "bot_server_counters" (
	"guild_id" text NOT NULL,
	"server_key" text NOT NULL,
	"channel_id" text NOT NULL,
	"template" text DEFAULT '{emoji} {label} : {count}' NOT NULL,
	CONSTRAINT "bot_server_counters_guild_id_server_key_pk" PRIMARY KEY("guild_id","server_key")
);
--> statement-breakpoint
CREATE TABLE "bot_servers" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"emoji" text DEFAULT '🎮' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 25565 NOT NULL,
	"rcon_host" text,
	"rcon_port" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_suggestion_votes" (
	"suggestion_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "bot_suggestion_votes_suggestion_id_user_id_pk" PRIMARY KEY("suggestion_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bot_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" text,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "bot_suggestions_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "bot_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"minecraft_username" text NOT NULL,
	"discord_id" text,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role_expires_at" timestamp with time zone,
	"role_removed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mute_role_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "sanction_propagate_mc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mc_ban_command" text DEFAULT 'ban {player} {reason}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mc_unban_command" text DEFAULT 'pardon {player}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mc_kick_command" text DEFAULT 'kick {player} {reason}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mc_mute_command" text DEFAULT 'mute {player} {duration}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "mc_unmute_command" text DEFAULT 'unmute {player}' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "rank_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "vote_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "vote_role_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "vote_role_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "vote_rcon_command" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "boost_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "boost_message" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "boost_rcon_command" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "suggestion_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_panel_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_panel_message_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "application_review_channel_id" text;--> statement-breakpoint
ALTER TABLE "bot_guild_config" ADD COLUMN "applications_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_level_roles" ADD COLUMN "rcon_command" text;--> statement-breakpoint
ALTER TABLE "bot_suggestion_votes" ADD CONSTRAINT "bot_suggestion_votes_suggestion_id_bot_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."bot_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_applications_guild_idx" ON "bot_applications" USING btree ("guild_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bot_rank_roles_guild_group_idx" ON "bot_rank_roles" USING btree ("guild_id","lp_group");--> statement-breakpoint
CREATE INDEX "bot_sanctions_user_idx" ON "bot_sanctions" USING btree ("guild_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_sanctions_due_idx" ON "bot_sanctions" USING btree ("active","expires_at");--> statement-breakpoint
CREATE INDEX "bot_servers_order_idx" ON "bot_servers" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE INDEX "bot_suggestions_guild_idx" ON "bot_suggestions" USING btree ("guild_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_votes_user_idx" ON "bot_votes" USING btree ("minecraft_username","voted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_votes_role_due_idx" ON "bot_votes" USING btree ("role_removed","role_expires_at");