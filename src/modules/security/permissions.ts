import { type GuildMember, PermissionFlagsBits, type Role } from "discord.js";

/**
 * Permissions qui permettent de détruire ou de prendre un serveur. Un rôle qui
 * en porte une est « sensible » : retiré à un auteur de nuke, surveillé quand
 * il est donné, et désigne le staff pour l'anti-usurpation.
 */
export const DANGEROUS_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageGuildExpressions |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers;

export function isDangerousRole(role: Role): boolean {
  return (role.permissions.bitfield & DANGEROUS_PERMISSIONS) !== 0n;
}

export function hasDangerousPermission(member: GuildMember): boolean {
  return (member.permissions.bitfield & DANGEROUS_PERMISSIONS) !== 0n;
}

/**
 * Retire les rôles sensibles d'un membre. Les rôles d'intégration (bots) ne
 * se retirent pas : c'est la quarantaine des bots qui les neutralise.
 * Retourne les rôles effectivement retirés (à mémoriser pour les rendre),
 * ou null si le membre est hors d'atteinte (propriétaire, rôle au-dessus du bot).
 */
export async function stripDangerousRoles(
  member: GuildMember,
  reason: string,
): Promise<string[] | null> {
  const roles = member.roles.cache.filter(
    (role) => role.id !== member.guild.id && !role.managed && isDangerousRole(role),
  );
  if (!roles.size) return [];
  if (!member.manageable) return null;
  const ids = [...roles.keys()];
  const ok = await member.roles
    .remove(ids, reason)
    .then(() => true)
    .catch(() => false);
  return ok ? ids : null;
}
