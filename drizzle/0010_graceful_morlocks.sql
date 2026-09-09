CREATE TABLE "bot_automod_rules" (
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"rule_id" text NOT NULL,
	CONSTRAINT "bot_automod_rules_guild_id_kind_pk" PRIMARY KEY("guild_id","kind")
);
