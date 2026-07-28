import type { GuildMember, Role } from "discord.js";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "../../db";
import { botLevelRoles } from "../../db/schema";
import { logger } from "../../lib/logger";

/** Grade fraîchement obtenu (sert à l'annonce en message privé). */
export interface GrantedLevelRole {
  role: Role;
  level: number;
}

/**
 * Applique les rôles récompense (mode cumulatif : tous les rôles dont le
 * niveau requis est ≤ au niveau du membre) et retourne ceux qui viennent
 * d'être obtenus, du plus bas niveau au plus haut.
 */
export async function applyLevelRoles(
  member: GuildMember,
  level: number,
): Promise<GrantedLevelRole[]> {
  const rows = await db
    .select()
    .from(botLevelRoles)
    .where(
      and(eq(botLevelRoles.guildId, member.guild.id), lte(botLevelRoles.level, level)),
    )
    .orderBy(asc(botLevelRoles.level));

  const granted = rows.flatMap<GrantedLevelRole>((row) => {
    const role = member.guild.roles.cache.get(row.roleId);
    if (!role || member.roles.cache.has(role.id)) return [];
    return [{ role, level: row.level }];
  });
  if (!granted.length) return [];

  try {
    await member.roles.add(
      granted.map((g) => g.role),
      `Récompense de niveau ${level}`,
    );
  } catch (err) {
    logger.warn(
      { err, userId: member.id, roles: granted.map((g) => g.role.id) },
      "Impossible d'appliquer les rôles récompense (hiérarchie de rôles ?)",
    );
    return []; // rien à annoncer si l'attribution a échoué
  }

  return granted;
}
