import mysql from "mysql2/promise";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { env, linkDbConfigured } from "../config";

/**
 * Accès à la MySQL du plugin clover-core, limité aux tables du module `link` :
 * `clover_link_codes` (codes à usage unique) et `clover_link_accounts` (miroir des
 * liaisons déjà faites). Contrat complet :
 * Plugin/clover/documentation/modules/link.md — la consommation DOIT rester un
 * UPDATE gardé par `consumed_at IS NULL AND expires_at > now` (usage unique,
 * même si le site valide le même code au même instant).
 *
 * Le reste de la base du plugin est hors périmètre : ne rien y lire ni écrire d'autre.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  pool ??= mysql.createPool({
    host: env.MINECRAFT_DB_HOST!,
    port: env.MINECRAFT_DB_PORT ?? 3306,
    user: env.MINECRAFT_DB_USER!,
    password: env.MINECRAFT_DB_PASSWORD ?? "",
    database: env.MINECRAFT_DB_NAME!,
    connectionLimit: 2,
    connectTimeout: 5_000,
  });
  return pool;
}

// Même préfixe que storage.table-prefix côté plugin ; assaini par prudence
// car il est interpolé dans le SQL (les identifiants ne sont pas paramétrables).
const PREFIX = (env.MINECRAFT_DB_TABLE_PREFIX ?? "clover_").replace(/[^A-Za-z0-9_]/g, "");
const TABLE = `${PREFIX}link_codes`;
const ACCOUNTS_TABLE = `${PREFIX}link_accounts`;

/** Le bot n'écrit que ses propres lignes du miroir ; celles du site portent source = 'SITE'. */
const SOURCE_BOT = "BOT";
const CHANNEL_DISCORD = "DISCORD";

export interface LinkCodeRow {
  playerUuid: string;
  playerName: string;
}

/** Normalise la saisie : majuscules, sans les tirets/espaces du format d'affichage ABCD-EFGH. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Le code est-il encore consommable ? Lecture seule, aucun effet. */
export async function peekLinkCode(code: string): Promise<LinkCodeRow | null> {
  if (!linkDbConfigured) return null;
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT player_uuid, player_name FROM ${TABLE} WHERE code = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
    [code, Date.now()],
  );
  const row = rows[0];
  return row
    ? { playerUuid: row.player_uuid as string, playerName: row.player_name as string }
    : null;
}

/**
 * Recopie la liaison Discord dans le miroir lu par la commande /lier du plugin, pour
 * qu'elle cesse de proposer Discord à quelqu'un qui vient de le faire. Purement
 * consultatif : la vérité reste bot_minecraft_links, et un échec ici ne doit jamais
 * faire échouer la liaison elle-même.
 *
 * Le DELETE préalable déplace la ligne quand ce Discord change de pseudo Minecraft,
 * au lieu de laisser une liaison fantôme sur l'ancien UUID.
 */
export async function recordLinkMirror(
  playerUuid: string,
  discordId: string,
  discordLabel: string,
): Promise<void> {
  if (!linkDbConfigured) return;
  const dbPool = getPool();
  await dbPool.query(
    `DELETE FROM ${ACCOUNTS_TABLE} WHERE source = ? AND channel = ? AND reference = ?`,
    [SOURCE_BOT, CHANNEL_DISCORD, discordId],
  );
  await dbPool.query(
    `INSERT INTO ${ACCOUNTS_TABLE} (player_uuid, channel, source, reference, label, linked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reference = VALUES(reference), label = VALUES(label),
                             linked_at = VALUES(linked_at)`,
    [playerUuid, CHANNEL_DISCORD, SOURCE_BOT, discordId, discordLabel.slice(0, 64), Date.now()],
  );
}

/**
 * Retire du miroir la ligne posée par ce bot. Le filtre sur `source` est essentiel :
 * un /delier ne doit pas effacer la liaison Discord qu'apporte l'OAuth du compte du
 * site, qui reste active pour la synchro (c'est déjà ce que /delier répond au joueur).
 */
export async function forgetLinkMirror(playerUuid: string): Promise<void> {
  if (!linkDbConfigured) return;
  await getPool().query(
    `DELETE FROM ${ACCOUNTS_TABLE} WHERE player_uuid = ? AND channel = ? AND source = ?`,
    [playerUuid, CHANNEL_DISCORD, SOURCE_BOT],
  );
}

/**
 * Consomme le code (usage unique). Retourne le compte Minecraft prouvé, ou null si
 * le code est inconnu, expiré ou déjà utilisé — y compris s'il vient d'être consommé
 * par le site dans l'intervalle.
 */
export async function consumeLinkCode(
  code: string,
  discordId: string,
  discordLabel: string,
): Promise<LinkCodeRow | null> {
  if (!linkDbConfigured) return null;
  const dbPool = getPool();
  const [result] = await dbPool.query<ResultSetHeader>(
    `UPDATE ${TABLE} SET consumed_at = ?, consumed_channel = 'DISCORD', consumed_reference = ?, consumed_label = ?
     WHERE code = ? AND consumed_at IS NULL AND expires_at > ?`,
    [Date.now(), discordId, discordLabel.slice(0, 64), code, Date.now()],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await dbPool.query<RowDataPacket[]>(
    `SELECT player_uuid, player_name FROM ${TABLE} WHERE code = ? LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row
    ? { playerUuid: row.player_uuid as string, playerName: row.player_name as string }
    : null;
}
