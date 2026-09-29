import { AuditLogEvent, type GuildMember, type PartialGuildMember } from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { findAuditEntry } from "../logs/audit";
import { recordIncident } from "./incidents";

/**
 * Le rôle de sécurité ne se donne que par le propriétaire : il ouvre le droit
 * de couper les protections, un administrateur compromis ne doit donc pas
 * pouvoir se l'attribuer. Tout autre octroi est annulé.
 *
 * Sans audit lisible, l'auteur est inconnu et le rôle est retiré quand même :
 * le propriétaire peut le redonner, alors qu'un octroi frauduleux laissé en
 * place ouvre toutes les protections.
 */
export async function guardSecurityRole(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  const guild = newMember.guild;
  const { securityRoleId } = await getGuildConfig(guild.id);
  if (!securityRoleId) return;
  if (!newMember.roles.cache.has(securityRoleId)) return;
  // Membre partiel : ancien état inconnu, l'audit tranchera.
  if (!oldMember.partial && oldMember.roles.cache.has(securityRoleId)) return;
  if (newMember.id === guild.ownerId) return;

  const entry = await findAuditEntry(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
  const granted = entry?.changes.some(
    (change) =>
      change.key === "$add" &&
      Array.isArray(change.new) &&
      change.new.some((role) => role.id === securityRoleId),
  );
  // Membre partiel et entrée fraîche sans ce rôle : l'octroi est ancien, rien
  // de frais à juger. Membre complet : l'octroi est certain, seul l'auteur
  // reste inconnu (entrée d'audit pas encore publiée).
  if (oldMember.partial && !granted) return;
  const executorId = granted ? (entry?.executorId ?? null) : null;
  // Le bot ne fait que rendre un rôle retiré (annulation d'incident, restauration).
  if (executorId === guild.ownerId || executorId === guild.client.user.id) return;

  const removed = await newMember.roles
    .remove(securityRoleId, "Rôle de sécurité : seul le propriétaire peut le donner")
    .then(() => true)
    .catch(() => false);

  await recordIncident(guild, {
    type: "security-role",
    actorId: executorId,
    targetId: newMember.id,
    summary: `Le rôle de sécurité <@&${securityRoleId}> a été donné à ${newMember} par ${executorId ? `<@${executorId}>` : "un auteur inconnu"}. Seul le propriétaire peut le donner.`,
    measures: [removed ? "Rôle retiré" : "⚠️ Retrait du rôle refusé (hiérarchie ou permissions)"],
  });
}
