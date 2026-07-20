import type { GuildMember } from "discord.js";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { botLevelRoles } from "../../db/schema";
import { logger } from "../../lib/logger";

/**
 * Applique les rôles récompense (mode cumulatif : tous les rôles dont le
 * niveau requis est ≤ au niveau du membre).
 */
export async function applyLevelRoles(
  member: GuildMember,
  level: number,
): Promise<void> {
  const rows = await db
    .select()
    .from(botLevelRoles)
    .where(
      and(eq(botLevelRoles.guildId, member.guild.id), lte(botLevelRoles.level, level)),
    );

  const toAdd = rows
    .map((r) => r.roleId)
    .filter(
      (roleId) =>
        member.guild.roles.cache.has(roleId) && !member.roles.cache.has(roleId),
    );
  if (!toAdd.length) return;

  try {
    await member.roles.add(toAdd, `Récompense de niveau ${level}`);
  } catch (err) {
    logger.warn(
      { err, userId: member.id, roles: toAdd },
      "Impossible d'appliquer les rôles récompense (hiérarchie de rôles ?)",
    );
  }
}
