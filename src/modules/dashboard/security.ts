import { ChannelType, type Guild, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { getMembership, networkGuilds } from "../network/manager";
import { createBackup, listBackups } from "../security/backups";
import { approveBot, kickQuarantinedBot, pendingBots } from "../security/bot-quarantine";
import { getIncident, incidentLabel, recentIncidents, undoIncident } from "../security/incidents";
import { imageAnalysisConfigured } from "../security/nsfw";
import { outboundAvailable } from "../security/outbound";
import { addTrusted, hasSecurityAuthority, listTrusted, removeTrusted } from "../security/trust";
import { PROTECTED_MODULES } from "./modules";
import { Refusal } from "./refusal";
import { snowflake } from "./validation";

/**
 * Sécurité vue du dashboard. Mêmes règles que `/securite` : la lecture suit
 * les droits du dashboard, toute écriture exige l'autorité de sécurité
 * (propriétaire ou rôle de sécurité) de l'acteur Discord — les droits
 * délégués du dashboard ne suffisent pas. La restauration d'une sauvegarde et
 * le webhook sortant (secret montré une seule fois) restent sur Discord.
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max).optional();

/** Réglages modifiables, bornés comme les options de `/securite seuils`. */
export const securityPatch = z
  .object({
    nukeDeleteThreshold: int(0, 50),
    nukeBanThreshold: int(0, 50),
    nukeCreateThreshold: int(0, 100),
    nukeWindowSec: int(3, 120),
    nukeRestore: z.boolean().optional(),
    spamMaxMessages: int(0, 50),
    spamWindowSec: int(2, 60),
    spamMaxMentions: int(0, 50),
    spamMaxChars: int(200, 4000),
    spamMaxLines: int(5, 200),
    spamDuplicateAccounts: int(0, 20),
    spamTimeoutMinutes: int(0, 1440),
    phishingTimeoutMinutes: int(0, 10080),
    nsfwThreshold: int(30, 100),
    nsfwImages: z.boolean().optional(),
    staffMinAccountAgeDays: int(0, 365),
    staffMinMemberDays: int(0, 365),
    impersonationQuarantine: z.boolean().optional(),
    backupIntervalHours: int(0, 168),
    backupMessagesPerChannel: int(0, 100),
    backupRetention: int(1, 50),
    raidLockdownMinAgeDays: int(0, 365),
    securityAlertChannelId: z
      .union([snowflake, z.literal(""), z.null()])
      .transform((v) => v || null)
      .optional(),
  })
  .strict();

const writeInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), values: securityPatch }),
  z.object({ action: z.literal("undo"), id: z.number().int().positive() }),
  z.object({ action: z.literal("backup"), label: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("bot"), botId: snowflake, decision: z.enum(["approve", "kick"]) }),
  z.object({ action: z.literal("trust"), userId: snowflake, remove: z.boolean().default(false) }),
]);

/** Résumé joint au `snapshot` du dashboard. */
export async function securitySummary(guild: Guild, actorId: string | undefined) {
  const cfg = await getGuildConfig(guild.id);
  const membership = await getMembership(guild.id);
  const settings = Object.fromEntries(
    Object.keys(securityPatch.shape).map((key) => [key, cfg[key as keyof typeof cfg]]),
  );
  return {
    authority: actorId ? await hasSecurityAuthority(guild, actorId) : false,
    ownerId: guild.ownerId,
    securityRoleId: cfg.securityRoleId,
    protectedModules: [...PROTECTED_MODULES],
    settings,
    verification: { state: cfg.verifyState, mode: cfg.verifyMode, roleId: cfg.verifyRoleId },
    incidents: (await recentIncidents(guild.id, 25)).map((i) => ({
      id: i.id,
      type: i.type,
      label: incidentLabel(i.type),
      actorId: i.actorId,
      summary: i.summary,
      measures: i.measures,
      undoable: Boolean(i.restore) && !i.resolvedAt,
      resolvedAt: i.resolvedAt,
      createdAt: i.createdAt,
    })),
    trusted: await listTrusted(guild.id),
    pendingBots: (await pendingBots(guild.id)).map((b) => ({
      botId: b.botId,
      name: guild.members.cache.get(b.botId)?.user.username ?? b.botId,
      addedBy: b.addedBy,
      createdAt: b.createdAt,
    })),
    backups: await listBackups(guild.id, 10),
    network: membership
      ? {
          name: membership.network.name,
          shareBans: membership.member.shareBans,
          guilds: (await networkGuilds(membership.network.id)).length,
        }
      : null,
    imageAnalysis: imageAnalysisConfigured,
    outbound: { available: outboundAvailable, configured: Boolean(cfg.outboundWebhookUrl) },
  };
}

export async function securityWrite(guild: Guild, actorId: string, payload: unknown) {
  if (!(await hasSecurityAuthority(guild, actorId)))
    throw new Refusal(403, "Réservé au propriétaire du serveur et au rôle de sécurité.");
  const input = writeInput.parse(payload);

  switch (input.action) {
    case "settings": {
      const { securityAlertChannelId } = input.values;
      if (securityAlertChannelId) {
        const channel = await guild.channels.fetch(securityAlertChannelId).catch(() => null);
        const me = await guild.members.fetchMe();
        if (
          channel?.type !== ChannelType.GuildText ||
          !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        )
          throw new Refusal(400, "Le bot ne peut pas écrire dans ce salon.");
      }
      await updateGuildConfig(guild.id, input.values);
      return { saved: true };
    }
    case "undo": {
      const incident = await getIncident(guild.id, input.id);
      if (!incident) throw new Refusal(404, "Incident introuvable.");
      if (incident.resolvedAt) throw new Refusal(409, "Cet incident a déjà été annulé.");
      return { warnings: await undoIncident(guild, incident, actorId) };
    }
    case "backup": {
      const backup = await createBackup(guild, "manuel", actorId, input.label || null);
      return { id: backup.id };
    }
    case "bot": {
      const error =
        input.decision === "approve"
          ? await approveBot(guild, input.botId, actorId)
          : await kickQuarantinedBot(guild, input.botId, actorId);
      if (error) throw new Refusal(409, error);
      return { saved: true };
    }
    case "trust": {
      if (input.remove) {
        if (!(await removeTrusted(guild.id, input.userId)))
          throw new Refusal(404, "Ce compte n'est pas dans la liste.");
      } else {
        await addTrusted(guild.id, input.userId, actorId);
      }
      return { saved: true };
    }
  }
}
