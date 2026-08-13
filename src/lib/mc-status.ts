import { status } from "minecraft-server-util";
import { env } from "../config";
import { logger } from "./logger";
import { getDefaultServer, type NetworkServer } from "./servers";

export interface McStatus {
  online: boolean;
  players: number;
  maxPlayers: number;
  latencyMs: number | null;
  version: string | null;
}

const CACHE_TTL_MS = 30_000;

/** Cache par cible « host:port » : les serveurs du réseau se pinguent à part. */
const cache = new Map<string, { at: number; value: McStatus }>();

const OFFLINE: McStatus = {
  online: false,
  players: 0,
  maxPlayers: 0,
  latencyMs: null,
  version: null,
};

/** Ping SLP d'une adresse précise, avec cache de 30 s. */
export async function getStatusOf(
  host: string,
  port: number,
  force = false,
): Promise<McStatus> {
  const key = `${host}:${port}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: McStatus;
  try {
    const res = await status(host, port, { timeout: 5_000, enableSRV: true });
    value = {
      online: true,
      players: res.players.online,
      maxPlayers: res.players.max,
      latencyMs: res.roundTripLatency,
      version: res.version.name,
    };
  } catch (err) {
    logger.debug({ err, host, port }, "Serveur Minecraft injoignable");
    value = OFFLINE;
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Ping d'un serveur du registre. */
export function getServerStatus(
  server: NetworkServer,
  force = false,
): Promise<McStatus> {
  return getStatusOf(server.host, server.port, force);
}

/**
 * Ping de l'adresse publique du réseau : le serveur marqué par défaut, ou
 * `MC_HOST`/`MC_PORT` tant que le registre n'a pas été semé.
 */
export async function getMcStatus(force = false): Promise<McStatus> {
  const server = await getDefaultServer().catch(() => null);
  if (server) return getServerStatus(server, force);
  return getStatusOf(env.MC_HOST, env.MC_PORT, force);
}
