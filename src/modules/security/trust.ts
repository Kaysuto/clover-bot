import type { Guild } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botSecurityTrusted } from "../../db/schema";

/**
 * Qui les protections laissent agir. Deux niveaux :
 *
 * - **autorité** : le propriétaire et les porteurs du rôle de sécurité. Eux
 *   seuls coupent un module protégé, gèrent la liste de confiance et lèvent
 *   une mesure automatique ;
 * - **confiance** : l'autorité, le bot lui-même et la liste
 *   `bot_security_trusted`. Les protections ne sanctionnent jamais un compte
 *   de confiance.
 */

/**
 * Cache de la liste de confiance : elle est consultée à chaque action
 * surveillée (suppression de salon, octroi de rôle…) et ne change que par
 * `addTrusted`/`removeTrusted`, qui l'invalident.
 */
const trustedCache = new Map<string, Promise<Set<string>>>();

function loadTrusted(guildId: string): Promise<Set<string>> {
  const hit = trustedCache.get(guildId);
  if (hit) return hit;

  const value = db
    .select({ userId: botSecurityTrusted.userId })
    .from(botSecurityTrusted)
    .where(eq(botSecurityTrusted.guildId, guildId))
    .then((rows) => new Set(rows.map((r) => r.userId)))
    .catch((err: unknown) => {
      trustedCache.delete(guildId);
      throw err;
    });
  trustedCache.set(guildId, value);
  return value;
}

export const AUTHORITY_REFUSAL =
  "Réservé au propriétaire du serveur et au rôle de sécurité.";

/** Propriétaire ou porteur du rôle de sécurité. */
export async function hasSecurityAuthority(guild: Guild, userId: string): Promise<boolean> {
  if (userId === guild.ownerId) return true;
  const { securityRoleId } = await getGuildConfig(guild.id);
  if (!securityRoleId) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  return member?.roles.cache.has(securityRoleId) ?? false;
}

/** Compte que les protections ne sanctionnent pas. */
export async function isTrusted(guild: Guild, userId: string): Promise<boolean> {
  if (userId === guild.client.user.id) return true;
  if ((await loadTrusted(guild.id)).has(userId)) return true;
  return hasSecurityAuthority(guild, userId);
}

export async function listTrusted(guildId: string): Promise<string[]> {
  return [...(await loadTrusted(guildId))];
}

export async function addTrusted(guildId: string, userId: string, addedBy: string): Promise<void> {
  await db
    .insert(botSecurityTrusted)
    .values({ guildId, userId, addedBy })
    .onConflictDoNothing();
  trustedCache.delete(guildId);
}

/** Retourne faux si le compte n'était pas dans la liste. */
export async function removeTrusted(guildId: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(botSecurityTrusted)
    .where(and(eq(botSecurityTrusted.guildId, guildId), eq(botSecurityTrusted.userId, userId)))
    .returning({ userId: botSecurityTrusted.userId });
  trustedCache.delete(guildId);
  return removed.length > 0;
}
