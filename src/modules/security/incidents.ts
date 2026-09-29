import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
} from "discord.js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botSecurityIncidents } from "../../db/schema";
import { ERROR_COLOR, brandEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import { sendLog } from "../logs/channel";
import { forwardToNetwork } from "../network/manager";
import { enqueueDelivery } from "./outbound";

/** Types d'incident (clé technique → libellé affiché). */
export const INCIDENT_TYPES = {
  "security-role": "Rôle de sécurité donné sans autorisation",
  nuke: "Destruction en série",
  "everyone-perms": "Permissions dangereuses données à @everyone",
  "bot-quarantine": "Nouveau bot en quarantaine",
  spam: "Spam",
  "raid-coordonne": "Raid coordonné",
  phishing: "Lien d'hameçonnage",
  webhook: "Webhook non autorisé",
  nsfw: "Contenu NSFW",
  "staff-watch": "Rôle sensible donné à un compte à risque",
  usurpation: "Usurpation du staff",
} as const;

export type IncidentType = keyof typeof INCIDENT_TYPES;

export type Incident = typeof botSecurityIncidents.$inferSelect;

/** Ce qu'il faut pour annuler les mesures d'un incident (cf. `undoIncident`). */
export interface IncidentRestore {
  /** Rôles retirés, à rendre. */
  roles?: Array<{ memberId: string; roleIds: string[] }>;
  /** Permissions de rôle modifiées, à remettre. */
  rolePermissions?: Array<{ roleId: string; permissions: string }>;
  /** Exclusions temporaires posées, à lever. */
  timeouts?: string[];
}

export interface IncidentInput {
  type: IncidentType;
  /** Auteur de l'action détectée (null si l'audit ne le donne pas). */
  actorId: string | null;
  /** Membre, rôle ou salon visé. */
  targetId?: string | null;
  summary: string;
  /** Mesures réellement appliquées, une par ligne d'alerte. */
  measures: string[];
  restore?: IncidentRestore;
  /** Relayer l'incident aux autres serveurs du réseau (défaut : oui). */
  shareWithNetwork?: boolean;
  /** Boutons de l'alerte ; à défaut, « Annuler la mesure » si `restore` est fourni. */
  actions?: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * Point d'entrée unique de toutes les protections : trace en base, puis
 * alerte, webhook sortant et réseau. Aucune de ces diffusions ne doit faire
 * échouer la protection qui appelle — la mesure est déjà prise ici.
 */
export async function recordIncident(guild: Guild, input: IncidentInput): Promise<Incident> {
  const [incident] = await db
    .insert(botSecurityIncidents)
    .values({
      guildId: guild.id,
      type: input.type,
      actorId: input.actorId,
      targetId: input.targetId ?? null,
      summary: input.summary,
      measures: input.measures,
      restore: input.restore ?? null,
    })
    .returning();
  if (!incident) throw new Error("Incident non enregistré");

  logger.warn(
    { guildId: guild.id, incidentId: incident.id, type: input.type, actorId: input.actorId },
    "Incident de sécurité",
  );
  await alertIncident(guild, incident, input.actions).catch((err: unknown) =>
    logger.warn({ err, guildId: guild.id }, "Alerte d'incident impossible"),
  );
  await enqueueDelivery(guild.id, "incident", incidentPayload(guild, incident)).catch(
    (err: unknown) => logger.warn({ err, guildId: guild.id }, "Webhook sortant non planifié"),
  );
  if (input.shareWithNetwork !== false) {
    await forwardToNetwork(guild, incidentEmbed(incident)).catch((err: unknown) =>
      logger.warn({ err, guildId: guild.id }, "Relais réseau impossible"),
    );
  }
  return incident;
}

export function incidentLabel(type: string): string {
  return INCIDENT_TYPES[type as IncidentType] ?? type;
}

export function incidentEmbed(incident: Incident) {
  return brandEmbed()
    .setColor(ERROR_COLOR)
    .setTitle(`🛡️ ${incidentLabel(incident.type)}`)
    .setDescription(incident.summary)
    .addFields(
      { name: "Auteur", value: incident.actorId ? `<@${incident.actorId}>` : "*inconnu*", inline: true },
      { name: "Incident", value: `#${incident.id}`, inline: true },
      { name: "Mesures", value: incident.measures.join("\n").slice(0, 1_024) || "aucune" },
    )
    .setTimestamp(incident.createdAt);
}

/** Corps JSON du webhook sortant : stable, sans mention Discord à interpréter. */
function incidentPayload(guild: Guild, incident: Incident) {
  return {
    id: incident.id,
    type: incident.type,
    label: incidentLabel(incident.type),
    guild: { id: guild.id, name: guild.name },
    actorId: incident.actorId,
    targetId: incident.targetId,
    summary: incident.summary,
    measures: incident.measures,
    createdAt: incident.createdAt.toISOString(),
  };
}

/** Salon d'alerte sécurité s'il est joignable, sinon le log « sécurité ». */
async function alertIncident(
  guild: Guild,
  incident: Incident,
  actions: ActionRowBuilder<ButtonBuilder>[] | undefined,
): Promise<void> {
  const embed = incidentEmbed(incident);
  const components = actions ?? (incident.restore
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildId("secu", "undo", incident.id))
            .setLabel("Annuler la mesure")
            .setStyle(ButtonStyle.Secondary),
        ),
      ]
    : []);
  const { securityAlertChannelId } = await getGuildConfig(guild.id);
  if (securityAlertChannelId) {
    const channel = await guild.channels.fetch(securityAlertChannelId).catch(() => null);
    // Envoi refusé (permissions retirées pendant l'attaque) : repli sur le log.
    const sent =
      channel?.isSendable() &&
      (await channel
        .send({ embeds: [embed], components })
        .then(() => true)
        .catch(() => false));
    if (sent) return;
  }
  await sendLog(guild, "securite", embed);
}

export async function recentIncidents(guildId: string, limit = 10): Promise<Incident[]> {
  return db
    .select()
    .from(botSecurityIncidents)
    .where(eq(botSecurityIncidents.guildId, guildId))
    .orderBy(desc(botSecurityIncidents.id))
    .limit(limit);
}

export async function getIncident(guildId: string, id: number): Promise<Incident | null> {
  const [row] = await db
    .select()
    .from(botSecurityIncidents)
    .where(and(eq(botSecurityIncidents.guildId, guildId), eq(botSecurityIncidents.id, id)));
  return row ?? null;
}

/**
 * Annule les mesures d'un incident : rôles rendus, permissions remises,
 * exclusions levées. L'incident n'est marqué résolu que si tout a réussi :
 * un échec (hiérarchie, membre parti puis revenu) doit rester rejouable.
 */
export async function undoIncident(
  guild: Guild,
  incident: Incident,
  by: string,
): Promise<string[]> {
  if (incident.resolvedAt) return [];
  const restore = (incident.restore ?? {}) as IncidentRestore;
  const reason = `Annulation de l'incident #${incident.id}`;
  const done: string[] = [];
  let failed = false;

  for (const { memberId, roleIds } of restore.roles ?? []) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    const roles = roleIds.filter((id) => guild.roles.cache.has(id));
    if (!member) {
      failed = true;
      done.push(`⚠️ <@${memberId}> n'est plus sur le serveur`);
      continue;
    }
    if (!roles.length) continue;
    const ok = await member.roles
      .add(roles, reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) failed = true;
    done.push(ok ? `Rôles rendus à <@${memberId}>` : `⚠️ Rôles non rendus à <@${memberId}>`);
  }
  for (const { roleId, permissions } of restore.rolePermissions ?? []) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    const ok = await role
      .setPermissions(BigInt(permissions), reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) failed = true;
    done.push(ok ? `Permissions de <@&${roleId}> remises` : `⚠️ Permissions de <@&${roleId}> inchangées`);
  }
  for (const memberId of restore.timeouts ?? []) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member?.isCommunicationDisabled()) continue;
    const ok = await member
      .timeout(null, reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) failed = true;
    done.push(ok ? `Exclusion de <@${memberId}> levée` : `⚠️ Exclusion de <@${memberId}> maintenue`);
  }

  if (failed) {
    done.push("L'incident reste ouvert : corrige la cause puis réessaie.");
    return done;
  }
  await db
    .update(botSecurityIncidents)
    .set({ resolvedAt: new Date(), resolvedBy: by })
    .where(eq(botSecurityIncidents.id, incident.id));
  return done;
}
