import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { botServers } from "../db/schema";
import { env } from "../config";
import { logger } from "./logger";

export type ServerRow = typeof botServers.$inferSelect;

/** Serveur du réseau, mot de passe RCON résolu depuis le `.env`. */
export interface NetworkServer extends ServerRow {
  rconPassword: string | null;
}

/**
 * Registre semé au premier démarrage : le réseau Clover a six serveurs, chacun
 * avec son allocation RCON (cf. panel Pterodactyl). Les valeurs sont des
 * défauts modifiables ensuite par `/config serveurs`.
 */
const SEED: Array<Omit<ServerRow, "enabled">> = [
  { key: "lobby", label: "Lobby", emoji: "🏠", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25081, isDefault: true, sortOrder: 0 },
  { key: "pvpsoup", label: "PvP Soup", emoji: "🍲", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25082, isDefault: false, sortOrder: 1 },
  { key: "skypvp", label: "SkyPvP", emoji: "☁️", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25083, isDefault: false, sortOrder: 2 },
  { key: "practice", label: "Practice", emoji: "⚔️", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25084, isDefault: false, sortOrder: 3 },
  { key: "creatif", label: "Créatif", emoji: "🎨", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25085, isDefault: false, sortOrder: 4 },
  { key: "bedwars", label: "BedWars", emoji: "🛏️", host: "play.clovergames.fr", port: 25565, rconHost: "176.172.100.198", rconPort: 25086, isDefault: false, sortOrder: 5 },
];

/**
 * Mot de passe RCON d'un serveur : `RCON_PASSWORD_LOBBY`, `RCON_PASSWORD_SKYPVP`…
 * Le serveur par défaut retombe sur l'historique `RCON_PASSWORD`, pour que la
 * configuration existante continue de marcher sans rien toucher.
 */
export function rconPasswordFor(server: ServerRow): string | null {
  const specific = process.env[`RCON_PASSWORD_${server.key.toUpperCase()}`];
  if (specific) return specific;
  if (server.isDefault && env.RCON_PASSWORD) return env.RCON_PASSWORD;
  return null;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: Promise<NetworkServer[]> } | null = null;

export function invalidateServers(): void {
  cache = null;
}

/** Serveurs actifs, triés pour l'affichage. */
export function getServers(): Promise<NetworkServer[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const value = loadServers().catch((err: unknown) => {
    cache = null;
    throw err;
  });
  cache = { at: Date.now(), value };
  return value;
}

async function loadServers(): Promise<NetworkServer[]> {
  const rows = await db
    .select()
    .from(botServers)
    .where(eq(botServers.enabled, true))
    .orderBy(asc(botServers.sortOrder), asc(botServers.key));
  return rows.map((row) => ({ ...row, rconPassword: rconPasswordFor(row) }));
}

export async function getServer(key: string): Promise<NetworkServer | null> {
  const servers = await getServers();
  return servers.find((s) => s.key === key) ?? null;
}

/** Serveur par défaut : celui marqué comme tel, sinon le premier de la liste. */
export async function getDefaultServer(): Promise<NetworkServer | null> {
  const servers = await getServers();
  return servers.find((s) => s.isDefault) ?? servers[0] ?? null;
}

/**
 * Crée les six serveurs du réseau s'ils n'existent pas encore. Idempotent :
 * `onConflictDoNothing` laisse intactes les lignes déjà personnalisées.
 */
export async function seedServers(): Promise<void> {
  const inserted = await db
    .insert(botServers)
    .values(SEED.map((s) => ({ ...s, enabled: true })))
    .onConflictDoNothing()
    .returning({ key: botServers.key });
  if (inserted.length) {
    logger.info(
      { servers: inserted.map((s) => s.key) },
      "Serveurs du réseau enregistrés",
    );
    invalidateServers();
  }
}

/** Adresse compacte pour l'affichage (`host` si le port est standard). */
export function serverAddress(server: ServerRow): string {
  return server.port === 25565 ? server.host : `${server.host}:${server.port}`;
}
