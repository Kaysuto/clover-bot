import { CloverClient } from "./client";
import { commands } from "./commands";
import { componentHandlers, dmComponentHandlers } from "./components";
import { env } from "./config";
import { pool } from "./db";
import { events } from "./events";
import { logger } from "./lib/logger";
import { stopAllJobs } from "./lib/scheduler";

const client = new CloverClient();

for (const command of commands) {
  client.commands.set(command.data.name, command);
}
for (const [prefix, handler] of Object.entries(componentHandlers)) {
  client.components.set(prefix, handler);
}
for (const [prefix, handler] of Object.entries(dmComponentHandlers)) {
  client.dmComponents.set(prefix, handler);
}
for (const event of events) {
  const listener = (...args: unknown[]) =>
    void (event.execute as (c: CloverClient, ...a: unknown[]) => unknown)(
      client,
      ...args,
    );
  if (event.once) client.once(event.name, listener);
  else client.on(event.name, listener);
}

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Promesse rejetée non gérée");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Exception non capturée");
  process.exit(1);
});

/** Délai au-delà duquel on coupe sans attendre (Docker tue à 10 s). */
const SHUTDOWN_TIMEOUT_MS = 5_000;

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Arrêt du bot…");
  stopAllJobs();

  // Une requête Neon bloquée ne doit pas empêcher le process de rendre la main.
  const timeout = setTimeout(() => {
    logger.warn("Arrêt propre trop long, sortie forcée");
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  await client.destroy().catch(() => undefined);
  await pool.end().catch(() => undefined);
  clearTimeout(timeout);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(env.DISCORD_TOKEN).catch((err) => {
  logger.fatal({ err }, "Connexion à Discord impossible (token invalide ?)");
  process.exit(1);
});
