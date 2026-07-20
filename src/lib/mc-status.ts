import { status } from "minecraft-server-util";
import { env } from "../config";
import { logger } from "./logger";

export interface McStatus {
  online: boolean;
  players: number;
  maxPlayers: number;
  latencyMs: number | null;
  version: string | null;
}

const CACHE_TTL_MS = 30_000;

let cached: { at: number; value: McStatus } | null = null;

const OFFLINE: McStatus = {
  online: false,
  players: 0,
  maxPlayers: 0,
  latencyMs: null,
  version: null,
};

/** Ping SLP du serveur Minecraft, avec cache de 30 s. */
export async function getMcStatus(force = false): Promise<McStatus> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  let value: McStatus;
  try {
    const res = await status(env.MC_HOST, env.MC_PORT, {
      timeout: 5_000,
      enableSRV: true,
    });
    value = {
      online: true,
      players: res.players.online,
      maxPlayers: res.players.max,
      latencyMs: res.roundTripLatency,
      version: res.version.name,
    };
  } catch (err) {
    logger.debug({ err }, "Serveur Minecraft injoignable");
    value = OFFLINE;
  }

  cached = { at: Date.now(), value };
  return value;
}
