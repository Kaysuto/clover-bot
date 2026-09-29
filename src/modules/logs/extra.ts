import {
  type AnyThreadChannel,
  AuditLogEvent,
  type Collection,
  type Guild,
  type GuildEmoji,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type OmitPartialGroupDMChannel,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
  type Sticker,
} from "discord.js";
import { auditFooter, findAuditEntry } from "./audit";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, trim, userLine } from "./format";

/**
 * Catégories ajoutées avec l'intent MessageContent et la suite sécurité :
 * messages, fils, émojis et stickers, webhooks et intégrations, réglages du
 * serveur. Même règle que les autres logs : best-effort, jamais bloquant.
 */

type AnyMessage = OmitPartialGroupDMChannel<Message | PartialMessage>;

// ─── Messages ────────────────────────────────────────────────────────────────

/** Seuls les messages en cache sont connus : un message plus ancien n'a plus de contenu à montrer. */
export async function logMessageDelete(message: AnyMessage): Promise<void> {
  if (message.partial || !message.inGuild() || message.author.bot) return;
  const entry = await findAuditEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id, {
    maxAgeMs: 5_000,
  });
  const byOther = entry && entry.executorId !== message.author.id ? entry : null;
  const attachments = [...message.attachments.values()].map((a) => a.name).join(", ");
  await sendLog(
    message.guild,
    "messages",
    logEmbed(LOG_COLOR.remove, "🗑️ Message supprimé").setDescription(
      trim(
        `${userLine(message.author)} dans ${message.channel}\n${message.content || "*sans texte*"}${attachments ? `\n**Pièces jointes** ${attachments}` : ""}${auditFooter(byOther)}`,
        4_000,
      ),
    ),
  );
}

export async function logMessageUpdate(oldMessage: AnyMessage, newMessage: AnyMessage): Promise<void> {
  if (oldMessage.partial || newMessage.partial || !newMessage.inGuild() || newMessage.author.bot) return;
  if (oldMessage.content === newMessage.content) return; // aperçu de lien ajouté, épinglage…
  await sendLog(
    newMessage.guild,
    "messages",
    logEmbed(LOG_COLOR.update, "✏️ Message modifié")
      .setDescription(`${userLine(newMessage.author)} dans ${newMessage.channel} · [aller au message](${newMessage.url})`)
      .addFields(
        { name: "Avant", value: trim(oldMessage.content || "*vide*") },
        { name: "Après", value: trim(newMessage.content || "*vide*") },
      ),
  );
}

export async function logMessageBulkDelete(
  messages: ReadonlyCollection<Snowflake, AnyMessage> | Collection<Snowflake, AnyMessage>,
  channel: GuildTextBasedChannel,
): Promise<void> {
  const entry = await findAuditEntry(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);
  await sendLog(
    channel.guild,
    "messages",
    logEmbed(LOG_COLOR.remove, "🧹 Suppression groupée").setDescription(
      `**${messages.size}** message(s) supprimé(s) dans ${channel}${auditFooter(entry)}`,
    ),
  );
}

// ─── Fils ────────────────────────────────────────────────────────────────────

export async function logThreadCreate(thread: AnyThreadChannel, newlyCreated: boolean): Promise<void> {
  if (!newlyCreated) return;
  await sendLog(
    thread.guild,
    "salons",
    logEmbed(LOG_COLOR.add, "🧵 Fil créé").setDescription(
      `${thread} · \`${thread.name}\` dans <#${thread.parentId}>${thread.ownerId ? `\n**Par** <@${thread.ownerId}>` : ""}`,
    ),
  );
}

export async function logThreadDelete(thread: AnyThreadChannel): Promise<void> {
  const entry = await findAuditEntry(thread.guild, AuditLogEvent.ThreadDelete, thread.id);
  await sendLog(
    thread.guild,
    "salons",
    logEmbed(LOG_COLOR.remove, "🧵 Fil supprimé").setDescription(
      `\`${thread.name}\` dans <#${thread.parentId}>${auditFooter(entry)}`,
    ),
  );
}

export async function logThreadUpdate(oldThread: AnyThreadChannel, newThread: AnyThreadChannel): Promise<void> {
  const changes: string[] = [];
  if (oldThread.name !== newThread.name) changes.push(`**Nom** \`${oldThread.name}\` → \`${newThread.name}\``);
  if (oldThread.archived !== newThread.archived) changes.push(newThread.archived ? "**Archivé**" : "**Désarchivé**");
  if (oldThread.locked !== newThread.locked) changes.push(newThread.locked ? "**Verrouillé**" : "**Déverrouillé**");
  if (!changes.length) return;
  await sendLog(
    newThread.guild,
    "salons",
    logEmbed(LOG_COLOR.update, "🧵 Fil modifié").setDescription(`${newThread}\n${changes.join("\n")}`),
  );
}

// ─── Émojis et stickers ──────────────────────────────────────────────────────

export async function logEmojiChange(
  kind: "create" | "delete" | "update",
  emoji: GuildEmoji,
  previous?: GuildEmoji,
): Promise<void> {
  const type = {
    create: AuditLogEvent.EmojiCreate,
    delete: AuditLogEvent.EmojiDelete,
    update: AuditLogEvent.EmojiUpdate,
  }[kind];
  const entry = await findAuditEntry(emoji.guild, type, emoji.id);
  const title = { create: "😀 Émoji ajouté", delete: "😶 Émoji supprimé", update: "✏️ Émoji renommé" }[kind];
  const name = previous && previous.name !== emoji.name ? `\`${previous.name}\` → \`${emoji.name}\`` : `\`${emoji.name}\``;
  await sendLog(
    emoji.guild,
    "emojis",
    logEmbed(kind === "delete" ? LOG_COLOR.remove : kind === "create" ? LOG_COLOR.add : LOG_COLOR.update, title)
      .setDescription(`${name}${auditFooter(entry)}`)
      .setThumbnail(emoji.imageURL()),
  );
}

export async function logStickerChange(
  kind: "create" | "delete" | "update",
  sticker: Sticker,
  previous?: Sticker,
): Promise<void> {
  const guild = sticker.guild;
  if (!guild) return;
  const type = {
    create: AuditLogEvent.StickerCreate,
    delete: AuditLogEvent.StickerDelete,
    update: AuditLogEvent.StickerUpdate,
  }[kind];
  const entry = await findAuditEntry(guild, type, sticker.id);
  const title = { create: "🏷️ Sticker ajouté", delete: "🏷️ Sticker supprimé", update: "✏️ Sticker modifié" }[kind];
  const name =
    previous && previous.name !== sticker.name ? `\`${previous.name}\` → \`${sticker.name}\`` : `\`${sticker.name}\``;
  await sendLog(
    guild,
    "emojis",
    logEmbed(kind === "delete" ? LOG_COLOR.remove : kind === "create" ? LOG_COLOR.add : LOG_COLOR.update, title)
      .setDescription(`${name}${auditFooter(entry)}`)
      .setThumbnail(sticker.url),
  );
}

// ─── Webhooks et intégrations ────────────────────────────────────────────────

const WEBHOOK_ACTIONS = [
  [AuditLogEvent.WebhookCreate, "créé"],
  [AuditLogEvent.WebhookUpdate, "modifié"],
  [AuditLogEvent.WebhookDelete, "supprimé"],
] as const;

/** `webhooksUpdate` ne dit pas ce qui a changé : l'audit le plus récent le dit. */
export async function logWebhooksUpdate(guild: Guild, channelId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  let best: { verb: string; executorId: string | null; name: string; at: number } | null = null;
  for (const [type, verb] of WEBHOOK_ACTIONS) {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 10_000) continue;
    if (!best || entry.createdTimestamp > best.at) {
      const target = entry.target as { name?: string } | null;
      best = { verb, executorId: entry.executorId, name: target?.name ?? "webhook", at: entry.createdTimestamp };
    }
  }
  await sendLog(
    guild,
    "integrations",
    logEmbed(LOG_COLOR.update, `🪝 Webhook ${best?.verb ?? "modifié"}`).setDescription(
      `${best ? `\`${best.name}\` · ` : ""}<#${channelId}>${best?.executorId ? `\n**Par** <@${best.executorId}>` : ""}`,
    ),
  );
}

export async function logBotAdd(bot: GuildMember, addedBy: string | null | undefined): Promise<void> {
  await sendLog(
    bot.guild,
    "integrations",
    logEmbed(LOG_COLOR.add, "🤖 Bot ajouté").setDescription(
      `${userLine(bot.user)}${addedBy ? `\n**Par** <@${addedBy}>` : ""}`,
    ),
  );
}

// ─── Serveur ─────────────────────────────────────────────────────────────────

export async function logGuildUpdate(oldGuild: Guild, newGuild: Guild): Promise<void> {
  const changes: string[] = [];
  if (oldGuild.name !== newGuild.name) changes.push(`**Nom** \`${oldGuild.name}\` → \`${newGuild.name}\``);
  if (oldGuild.icon !== newGuild.icon) changes.push("**Icône** modifiée");
  if (oldGuild.banner !== newGuild.banner) changes.push("**Bannière** modifiée");
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode)
    changes.push(`**URL personnalisée** \`${oldGuild.vanityURLCode ?? "aucune"}\` → \`${newGuild.vanityURLCode ?? "aucune"}\``);
  if (oldGuild.verificationLevel !== newGuild.verificationLevel)
    changes.push(`**Niveau de vérification** ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) changes.push("**Filtre de contenu** modifié");
  if (oldGuild.mfaLevel !== newGuild.mfaLevel) changes.push("**2FA des modérateurs** modifiée");
  if (oldGuild.ownerId !== newGuild.ownerId) changes.push(`**Propriétaire** <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`);
  if (oldGuild.systemChannelId !== newGuild.systemChannelId) changes.push("**Salon système** modifié");
  if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) changes.push("**Salon des règles** modifié");
  if (!changes.length) return;
  const entry = await findAuditEntry(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
  await sendLog(
    newGuild,
    "serveur",
    logEmbed(LOG_COLOR.update, "⚙️ Serveur modifié").setDescription(`${changes.join("\n")}${auditFooter(entry)}`),
  );
}
