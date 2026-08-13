import { Rcon } from "rcon-client";
import { env, rconConfigured } from "../config";
import { logger } from "./logger";
import {
  getDefaultServer,
  getServer,
  getServers,
  type NetworkServer,
} from "./servers";

interface RconTarget {
  key: string;
  host: string;
  port: number;
  password: string;
}

/** Cible RCON d'un serveur du registre, ou null s'il n'est pas configuré. */
function targetOf(server: NetworkServer): RconTarget | null {
  if (!server.rconHost || !server.rconPort || !server.rconPassword) return null;
  return {
    key: server.key,
    host: server.rconHost,
    port: server.rconPort,
    password: server.rconPassword,
  };
}

/**
 * Cible héritée du `.env` (RCON_HOST/PORT/PASSWORD), utilisée tant que le
 * registre des serveurs n'a pas de RCON exploitable pour le serveur par défaut.
 */
function legacyTarget(): RconTarget | null {
  if (!rconConfigured) return null;
  return {
    key: "legacy",
    host: env.RCON_HOST!,
    port: env.RCON_PORT!,
    password: env.RCON_PASSWORD!,
  };
}

async function resolveTarget(serverKey?: string): Promise<RconTarget | null> {
  const server = serverKey ? await getServer(serverKey) : await getDefaultServer();
  if (server) {
    const target = targetOf(server);
    if (target) return target;
    // Une clé explicite sans mot de passe est une erreur de configuration, pas
    // une invitation à taper sur un autre serveur.
    if (serverKey) return null;
  }
  return serverKey ? null : legacyTarget();
}

/**
 * Connexion RCON à la demande (adapté de siteweb/src/lib/rcon.ts).
 * Une connexion courte par appel : simple et sans état périmé.
 */
async function withRcon<T>(
  target: RconTarget,
  fn: (rcon: Rcon) => Promise<T>,
): Promise<T> {
  let rcon: Rcon | null = null;
  try {
    rcon = await Rcon.connect({
      host: target.host,
      port: target.port,
      password: target.password,
      timeout: 5_000,
    });
    return await fn(rcon);
  } finally {
    if (rcon) await rcon.end().catch(() => undefined);
  }
}

/** Vérifie que le RCON d'un serveur répond. */
export async function rconHealthCheck(serverKey?: string): Promise<{
  ok: boolean;
  latencyMs: number | null;
  configured: boolean;
}> {
  const target = await resolveTarget(serverKey);
  if (!target) return { ok: false, latencyMs: null, configured: false };

  const start = Date.now();
  try {
    await withRcon(target, (rcon) => rcon.send("list"));
    return { ok: true, latencyMs: Date.now() - start, configured: true };
  } catch (err) {
    logger.debug({ err, server: target.key }, "RCON injoignable");
    return { ok: false, latencyMs: null, configured: true };
  }
}

/** Exécute une commande console. Retourne null si RCON non configuré/KO. */
export async function rconCommand(
  command: string,
  serverKey?: string,
): Promise<string | null> {
  const target = await resolveTarget(serverKey);
  if (!target) {
    logger.debug({ command, serverKey }, "Commande RCON ignorée (non configuré)");
    return null;
  }
  try {
    return await withRcon(target, (rcon) => rcon.send(command));
  } catch (err) {
    logger.warn({ err, command, server: target.key }, "Échec de la commande RCON");
    return null;
  }
}

/**
 * Diffuse une commande à tous les serveurs dont le RCON est configuré : un
 * bannissement doit valoir partout, pas seulement sur le lobby. Retourne les
 * clés des serveurs qui ont accepté la commande.
 */
export async function rconBroadcast(command: string): Promise<string[]> {
  const servers = await getServers();
  const done: string[] = [];
  for (const server of servers) {
    const target = targetOf(server);
    if (!target) continue;
    try {
      await withRcon(target, (rcon) => rcon.send(command));
      done.push(server.key);
    } catch (err) {
      logger.warn(
        { err, command, server: server.key },
        "Commande RCON refusée par un serveur",
      );
    }
  }
  return done;
}
