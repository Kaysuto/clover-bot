CREATE TABLE "bot_guild_installations" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"guild_name" text NOT NULL,
	"owner_id" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
