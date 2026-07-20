import { Rcon } from "rcon-client";
import { env, rconConfigured } from "../config";
import { logger } from "./logger";

/**
 * Connexion RCON à la demande (adapté de siteweb/src/lib/rcon.ts).
 * Une connexion courte par appel : simple et sans état périmé.
 */
async function withRcon<T>(fn: (rcon: Rcon) => Promise<T>): Promise<T | null> {
  if (!rconConfigured) return null;
  let rcon: Rcon | null = null;
  try {
    rcon = await Rcon.connect({
      host: env.RCON_HOST!,
      port: env.RCON_PORT!,
      password: env.RCON_PASSWORD!,
      timeout: 5_000,
    });
    return await fn(rcon);
  } finally {
    if (rcon) await rcon.end().catch(() => undefined);
  }
}

/** Vérifie que le RCON répond. */
export async function rconHealthCheck(): Promise<{
  ok: boolean;
  latencyMs: number | null;
}> {
  if (!rconConfigured) return { ok: false, latencyMs: null };
  const start = Date.now();
  try {
    await withRcon((rcon) => rcon.send("list"));
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.debug({ err }, "RCON injoignable");
    return { ok: false, latencyMs: null };
  }
}

/** Exécute une commande console. Retourne null si RCON non configuré/KO. */
export async function rconCommand(command: string): Promise<string | null> {
  try {
    return await withRcon((rcon) => rcon.send(command));
  } catch (err) {
    logger.warn({ err, command }, "Échec de la commande RCON");
    return null;
  }
}
