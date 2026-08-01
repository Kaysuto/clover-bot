import "dotenv/config";
import { z } from "zod";

// "" dans le .env = non renseigné
const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const optionalPort = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional(),
);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN est requis"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID est requis"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID est requis"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),

  MC_HOST: z.string().min(1).default("play.clovergames.fr"),
  MC_PORT: z.coerce.number().int().positive().default(25565),

  // Statut affiché sous le nom du bot (« Joue à … »)
  BOT_ACTIVITY_NAME: z.string().min(1).default("play.clovergames.fr"),
  BOT_ACTIVITY_TYPE: z
    .enum(["Playing", "Listening", "Watching", "Competing"])
    .default("Playing"),

  RCON_HOST: optionalString,
  RCON_PORT: optionalPort,
  RCON_PASSWORD: optionalString,

  WEBSITE_URL: z.string().min(1).default("https://clovergames.fr"),
  DISCORD_MONITORING_WEBHOOK_URL: optionalString,

  // Codes de liaison in-game (table clover_link_codes du plugin, module link)
  MINECRAFT_DB_HOST: optionalString,
  MINECRAFT_DB_PORT: optionalPort,
  MINECRAFT_DB_USER: optionalString,
  MINECRAFT_DB_PASSWORD: optionalString,
  MINECRAFT_DB_NAME: optionalString,
  MINECRAFT_DB_TABLE_PREFIX: optionalString,

  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Configuration invalide (.env) :");
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join(".")} : ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export const rconConfigured = Boolean(
  env.RCON_HOST && env.RCON_PORT && env.RCON_PASSWORD,
);

/** MySQL du plugin (codes de liaison). Le mot de passe peut légitimement être vide en dev. */
export const linkDbConfigured = Boolean(
  env.MINECRAFT_DB_HOST && env.MINECRAFT_DB_USER && env.MINECRAFT_DB_NAME,
);
