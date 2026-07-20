import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant dans .env");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Base Neon partagée avec le site : drizzle-kit ne doit gérer QUE les tables du bot.
  tablesFilter: ["bot_*"],
  // Suivi des migrations séparé de celui du site (qui utilise la table par défaut).
  migrations: {
    table: "__bot_migrations",
    schema: "drizzle",
  },
});
