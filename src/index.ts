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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Arrêt du bot…");
  stopAllJobs();
  await client.destroy().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(env.DISCORD_TOKEN).catch((err) => {
  logger.fatal({ err }, "Connexion à Discord impossible (token invalide ?)");
  process.exit(1);
});
