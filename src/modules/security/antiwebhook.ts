import {
  AuditLogEvent,
  type ForumChannel,
  type Message,
  type MediaChannel,
  type NewsChannel,
  type TextChannel,
  type VoiceChannel,
} from "discord.js";
import type { GuildConfig } from "../../db/guild-config";
import { moduleEnabled } from "../dashboard/modules";
import { onWebhookCreate } from "./antinuke";
import { recordIncident } from "./incidents";
import { ownWebhooks } from "./snapshot";
import { isTrusted } from "./trust";

/**
 * Anti-webhook : un webhook créé par un compte non fiable est supprimé (il
 * permettrait de poster sans compte, donc sans sanction possible), et un
 * webhook qui flood est supprimé avec ses messages.
 */

type WebhookChannel = TextChannel | NewsChannel | VoiceChannel | ForumChannel | MediaChannel;

/** Entrées d'audit déjà traitées : `webhooksUpdate` se déclenche aussi à la suppression. */
const handled = new Set<string>();
const floods = new Map<string, number[]>();

export async function onWebhooksUpdate(channel: WebhookChannel): Promise<void> {
  const guild = channel.guild;
  if (!(await moduleEnabled(guild.id, "antiwebhook"))) return;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 25 }).catch(() => null);
  if (!logs) return;

  for (const entry of logs.entries.values()) {
    if (Date.now() - entry.createdTimestamp > 15_000 || handled.has(entry.id)) continue;
    handled.add(entry.id);
    const webhookId = entry.targetId;
    const actorId = entry.executorId;
    if (!webhookId || !actorId || ownWebhooks.has(webhookId)) continue;
    if (await isTrusted(guild, actorId)) continue;

    const webhook = (await guild.fetchWebhooks().catch(() => null))?.get(webhookId);
    const deleted = webhook
      ? await webhook
          .delete("Anti-webhook : créé par un compte non fiable")
          .then(() => true)
          .catch(() => false)
      : false;
    await recordIncident(guild, {
      type: "webhook",
      actorId,
      targetId: webhookId,
      summary: `<@${actorId}> a créé le webhook \`${webhook?.name ?? webhookId}\` dans <#${webhook?.channelId ?? channel.id}>. Seuls le propriétaire, le rôle de sécurité et les comptes de confiance peuvent en créer.`,
      measures: [deleted ? "Webhook supprimé" : "⚠️ Webhook non supprimé"],
      shareWithNetwork: false,
    });
    await onWebhookCreate(guild, actorId, async () => null);
  }
  if (handled.size > 1_000) handled.clear();
}

/** Supprime le webhook auteur d'un message ; retourne vrai en cas de succès. */
export async function deleteWebhookOf(message: Message<true>): Promise<boolean> {
  if (!message.webhookId || ownWebhooks.has(message.webhookId)) return false;
  const webhook = await message.fetchWebhook().catch(() => null);
  if (!webhook) return false;
  return webhook
    .delete("Anti-webhook : contenu malveillant")
    .then(() => true)
    .catch(() => false);
}

/** Webhook qui flood : supprimé avec ses messages récents. Vrai si traité. */
export async function checkWebhookMessage(message: Message<true>, cfg: GuildConfig): Promise<boolean> {
  const webhookId = message.webhookId;
  if (!webhookId || ownWebhooks.has(webhookId)) return false;
  // Annonces suivies depuis un autre serveur : pas un webhook qu'on gère.
  if (message.reference?.guildId && message.reference.guildId !== message.guildId) return false;
  if (!(await moduleEnabled(message.guildId, "antiwebhook"))) return false;

  const now = Date.now();
  const windowMs = cfg.spamWindowSec * 1_000;
  const stamps = (floods.get(webhookId) ?? []).filter((at) => now - at < windowMs);
  stamps.push(now);
  floods.set(webhookId, stamps);
  if (cfg.spamMaxMessages <= 0 || stamps.length <= cfg.spamMaxMessages) return false;
  floods.delete(webhookId);

  const deleted = await deleteWebhookOf(message);
  const ids = message.channel.messages.cache
    .filter((m) => m.webhookId === webhookId && now - m.createdTimestamp < windowMs * 2)
    .map((m) => m.id);
  if (ids.length && "bulkDelete" in message.channel)
    await message.channel.bulkDelete(ids, true).catch(() => undefined);

  await recordIncident(message.guild, {
    type: "webhook",
    actorId: null,
    targetId: webhookId,
    summary: `Le webhook \`${message.author.username}\` a posté ${stamps.length} messages en ${cfg.spamWindowSec} s dans ${message.channel}.`,
    measures: [deleted ? "Webhook supprimé" : "⚠️ Webhook non supprimé", `${ids.length} message(s) supprimé(s)`],
    shareWithNetwork: false,
  });
  return true;
}

export function pruneWebhookState(): void {
  const now = Date.now();
  for (const [key, stamps] of floods) if (stamps.every((at) => now - at > 60_000)) floods.delete(key);
}
