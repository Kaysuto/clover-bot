CREATE TABLE "bot_giveaway_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"giveaway_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"prize" text NOT NULL,
	"winners_count" integer DEFAULT 1 NOT NULL,
	"host_id" text NOT NULL,
	"required_role_id" text,
	"required_min_level" integer,
	"ends_at" timestamp with time zone NOT NULL,
	"ended" boolean DEFAULT false NOT NULL,
	"winner_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_giveaways_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "bot_guild_config" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"levelup_channel_id" text,
	"levelup_message" text DEFAULT '🎉 {user} passe au niveau **{level}** !' NOT NULL,
	"xp_min" integer DEFAULT 15 NOT NULL,
	"xp_max" integer DEFAULT 25 NOT NULL,
	"xp_cooldown_sec" integer DEFAULT 60 NOT NULL,
	"voice_xp_per_min" integer DEFAULT 5 NOT NULL,
	"no_xp_channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_role_id" text,
	"sync_nicknames" boolean DEFAULT true NOT NULL,
	"counter_channel_id" text,
	"counter_template" text DEFAULT '🎮 En ligne : {count}' NOT NULL,
	"ticket_category_id" text,
	"ticket_archive_channel_id" text,
	"ticket_support_role_id" text,
	"ticket_panel_channel_id" text,
	"ticket_panel_message_id" text,
	"ticket_counter" integer DEFAULT 0 NOT NULL,
	"tempvoice_hub_id" text,
	"tempvoice_category_id" text,
	"status_channel_id" text,
	"status_message_id" text,
	"log_channel_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_invite_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"member_id" text NOT NULL,
	"inviter_id" text,
	"code" text,
	"is_vanity" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "bot_invite_stats" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	"leaves" integer DEFAULT 0 NOT NULL,
	"seed_uses" integer DEFAULT 0 NOT NULL,
	"bonus" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bot_invite_stats_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bot_invites" (
	"guild_id" text NOT NULL,
	"code" text NOT NULL,
	"inviter_id" text,
	"uses" integer DEFAULT 0 NOT NULL,
	"is_vanity" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_invites_guild_id_code_pk" PRIMARY KEY("guild_id","code")
);
--> statement-breakpoint
CREATE TABLE "bot_level_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"level" integer NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_levels" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	"last_message_xp_at" timestamp,
	CONSTRAINT "bot_levels_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bot_minecraft_links" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"minecraft_uuid" text NOT NULL,
	"minecraft_username" text NOT NULL,
	"source" text DEFAULT 'CODE' NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_minecraft_links_minecraft_uuid_unique" UNIQUE("minecraft_uuid")
);
--> statement-breakpoint
CREATE TABLE "bot_temp_voice" (
	"voice_channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"text_channel_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"user_limit" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"ticket_number" integer NOT NULL,
	"channel_id" text NOT NULL,
	"opener_id" text NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'support' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"claimed_by" text,
	"closed_by" text,
	"close_reason" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "bot_tickets_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
ALTER TABLE "bot_giveaway_entries" ADD CONSTRAINT "bot_giveaway_entries_giveaway_id_bot_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."bot_giveaways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_giveaway_entries_unique_idx" ON "bot_giveaway_entries" USING btree ("giveaway_id","user_id");--> statement-breakpoint
CREATE INDEX "bot_giveaways_due_idx" ON "bot_giveaways" USING btree ("ended","ends_at");--> statement-breakpoint
CREATE INDEX "bot_invite_joins_inviter_idx" ON "bot_invite_joins" USING btree ("guild_id","inviter_id");--> statement-breakpoint
CREATE INDEX "bot_invite_joins_member_idx" ON "bot_invite_joins" USING btree ("guild_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_level_roles_guild_level_idx" ON "bot_level_roles" USING btree ("guild_id","level");--> statement-breakpoint
CREATE INDEX "bot_levels_guild_xp_idx" ON "bot_levels" USING btree ("guild_id","xp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_tickets_opener_idx" ON "bot_tickets" USING btree ("guild_id","opener_id","status");