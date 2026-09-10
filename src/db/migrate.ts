import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool } from "./index";

/** Met la base à jour avant toute connexion Discord ou lancement de job. */
export async function migrateDatabase(): Promise<void> {
  const connection = await pool.connect();
  try {
    // Même session pour le verrou et les migrations, y compris leur journal.
    await connection.query("SELECT pg_advisory_lock(hashtext('clover-bot:migrations'))");
    await migrate(drizzle(connection), {
      migrationsFolder: resolve(__dirname, "../../drizzle"),
      migrationsSchema: "drizzle",
      migrationsTable: "__bot_migrations",
    });
  } finally {
    try {
      await connection.query("SELECT pg_advisory_unlock(hashtext('clover-bot:migrations'))");
    } finally {
      // Ne jamais remettre une session potentiellement verrouillée dans le pool.
      connection.release(true);
    }
  }
}
