import mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { env, luckPermsConfigured } from "../config";
import { logger } from "./logger";

/**
 * Lecture SEULE des groupes LuckPerms, pour refléter les grades en jeu sur des
 * rôles Discord. Connexion distincte de `mc-db.ts` et pilotée par ses propres
 * variables `LUCKPERMS_DB_*` : la base du plugin clover-core est hors périmètre,
 * et LuckPerms vit le plus souvent ailleurs. Non configuré = fonction inactive.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  pool ??= mysql.createPool({
    host: env.LUCKPERMS_DB_HOST!,
    port: env.LUCKPERMS_DB_PORT ?? 3306,
    user: env.LUCKPERMS_DB_USER!,
    password: env.LUCKPERMS_DB_PASSWORD ?? "",
    database: env.LUCKPERMS_DB_NAME!,
    connectionLimit: 2,
    connectTimeout: 5_000,
  });
  return pool;
}

// Interpolé dans le SQL (un identifiant de table n'est pas paramétrable) : assaini.
const PREFIX = (env.LUCKPERMS_TABLE_PREFIX ?? "luckperms_").replace(
  /[^A-Za-z0-9_]/g,
  "",
);
const PLAYERS_TABLE = `${PREFIX}players`;
const PERMISSIONS_TABLE = `${PREFIX}user_permissions`;

export interface PlayerGroups {
  primaryGroup: string;
  /** Groupe principal + tous les héritages encore valides, en minuscules. */
  groups: string[];
}

/**
 * Groupes d'un joueur. L'UUID doit être au format à tirets utilisé par
 * LuckPerms. Retourne null si la fonction est inactive ou la base injoignable —
 * jamais une exception : un grade non résolu ne doit rien faire échouer.
 */
export async function getPlayerGroups(uuid: string): Promise<PlayerGroups | null> {
  if (!luckPermsConfigured) return null;

  try {
    const dbPool = getPool();
    const [players] = await dbPool.query<RowDataPacket[]>(
      `SELECT primary_group FROM ${PLAYERS_TABLE} WHERE uuid = ? LIMIT 1`,
      [uuid],
    );
    const primaryGroup = (players[0]?.primary_group as string | undefined) ?? "default";

    // `expiry = 0` = permanent chez LuckPerms ; les nœuds temporaires expirés
    // restent en base jusqu'au prochain passage du plugin, d'où le filtre.
    const [rows] = await dbPool.query<RowDataPacket[]>(
      `SELECT permission FROM ${PERMISSIONS_TABLE}
       WHERE uuid = ? AND value = 1 AND permission LIKE 'group.%'
         AND (expiry = 0 OR expiry > ?)`,
      [uuid, Math.floor(Date.now() / 1_000)],
    );

    const groups = new Set<string>([primaryGroup.toLowerCase()]);
    for (const row of rows) {
      const permission = String(row.permission);
      groups.add(permission.slice("group.".length).toLowerCase());
    }

    return { primaryGroup: primaryGroup.toLowerCase(), groups: [...groups] };
  } catch (err) {
    logger.warn({ err, uuid }, "Lecture des groupes LuckPerms impossible");
    return null;
  }
}

/** UUID Mojang sans tirets → format canonique attendu par LuckPerms. */
export function dashedUuid(uuid: string): string {
  const raw = uuid.replace(/-/g, "");
  if (raw.length !== 32) return uuid;
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    raw.slice(12, 16),
    raw.slice(16, 20),
    raw.slice(20),
  ].join("-");
}
