CREATE TABLE "bot_log_settings" (
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "bot_log_settings_guild_id_category_pk" PRIMARY KEY("guild_id","category")
);
