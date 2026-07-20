import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config";
import { logger } from "../lib/logger";
import * as schema from "./schema";
import * as siteSchema from "./site-schema";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
});

// Neon suspend le compute après inactivité : la connexion peut être coupée
// côté serveur. Le Pool en rouvrira une à la prochaine requête — il ne faut
// simplement pas crasher sur l'événement error.
pool.on("error", (err) => {
  logger.warn({ err }, "Connexion PostgreSQL perdue (reprise automatique)");
});

export const db = drizzle(pool, { schema: { ...schema, ...siteSchema } });
