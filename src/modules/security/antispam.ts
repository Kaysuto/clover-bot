import { type GuildTextBasedChannel, type Message, PermissionFlagsBits } from "discord.js";
import type { GuildConfig } from "../../db/guild-config";
import { sendLog } from "../logs/channel";
import { LOG_COLOR, logEmbed, trim, userLine } from "../logs/format";
import { recordIncident } from "./incidents";
import { deleteQuietly, timeoutMember } from "./sanctions";
import { contentFingerprint } from "./text";
import { isTrusted } from "./trust";

/**
 * Anti-spam de contenu, en complément d'AutoMod (qui bloque avant
 * publication mais ne voit ni le rythme d'un membre, ni le même texte posté
 * par plusieurs comptes). Fenêtres en mémoire, de quelques secondes.
 */

/** Fenêtre de détection du texte identique posté par plusieurs comptes. */
const DUPLICATE_WINDOW_MS = 30_000;
/** En dessous, un texte identique est banal (« salut », « gg »…). */
const DUPLICATE_MIN_LENGTH = 12;

const floods = new Map<string, number[]>();
const duplicates = new Map<
  string,
  Array<{ userId: string; channelId: string; messageId: string; at: number }>
>();

type GuildMessage = Message<true>;

/** Staff et comptes de confiance ne sont pas soumis à l'anti-spam. */
async function exempt(message: GuildMessage, cfg: GuildConfig): Promise<boolean> {
  if (cfg.spamExemptChannelIds.includes(message.channelId)) return true;
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  return isTrusted(message.guild, message.author.id);
}

/** Supprime les messages récents d'un membre dans un salon (cache seulement). */
async function purgeRecent(channel: GuildTextBasedChannel, userId: string, sinceMs: number) {
  const cutoff = Date.now() - sinceMs;
  const ids = channel.messages.cache
    .filter((m) => m.author.id === userId && m.createdTimestamp >= cutoff)
    .map((m) => m.id);
  if (!ids.length) return 0;
  if ("bulkDelete" in channel) {
    const deleted = await channel.bulkDelete(ids, true).catch(() => null);
    return deleted?.size ?? 0;
  }
  return 0;
}

async function sanction(
  message: GuildMessage,
  cfg: GuildConfig,
  summary: string,
  purgeMs: number,
): Promise<void> {
  const member = message.member;
  const purged = await purgeRecent(message.channel, message.author.id, purgeMs);
  await deleteQuietly(message);
  const minutes = member ? await timeoutMember(member, cfg.spamTimeoutMinutes, `Anti-spam : ${summary}`) : null;
  await recordIncident(message.guild, {
    type: "spam",
    actorId: message.author.id,
    targetId: message.author.id,
    summary: `${summary} dans ${message.channel}.`,
    measures: [
      `${Math.max(purged, 1)} message(s) supprimé(s)`,
      minutes ? `Exclu ${minutes} min` : "⚠️ Exclusion impossible (hiérarchie)",
    ],
    restore: minutes ? { timeouts: [message.author.id] } : undefined,
    shareWithNetwork: false,
  });
}

/** Retourne vrai si le message a été supprimé. */
export async function checkSpam(message: GuildMessage, cfg: GuildConfig): Promise<boolean> {
  if (cfg.disabledModules.includes("antispam")) return false;
  if (await exempt(message, cfg)) return false;
  const now = Date.now();
  const content = message.content;

  // Message géant : supprimé sans exclusion, souvent une maladresse.
  const lines = content.split("\n").length;
  if (content.length > cfg.spamMaxChars || lines > cfg.spamMaxLines) {
    await deleteQuietly(message);
    await sendLog(
      message.guild,
      "automod",
      logEmbed(LOG_COLOR.warn, "📏 Message géant supprimé").setDescription(
        `${userLine(message.author)} dans ${message.channel} — ${content.length} caractères, ${lines} lignes.\n${trim(content, 500)}`,
      ),
    );
    return true;
  }

  const mentions =
    message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
  if (cfg.spamMaxMentions > 0 && mentions >= cfg.spamMaxMentions) {
    await sanction(message, cfg, `${mentions} mentions en un message`, 0);
    return true;
  }

  // Flood : trop de messages du même membre dans la fenêtre.
  const floodKey = `${message.guildId}:${message.author.id}`;
  const windowMs = cfg.spamWindowSec * 1_000;
  const stamps = (floods.get(floodKey) ?? []).filter((at) => now - at < windowMs);
  stamps.push(now);
  floods.set(floodKey, stamps);
  if (cfg.spamMaxMessages > 0 && stamps.length > cfg.spamMaxMessages) {
    floods.delete(floodKey);
    await sanction(message, cfg, `${stamps.length} messages en ${cfg.spamWindowSec} s`, windowMs);
    return true;
  }

  return checkDuplicates(message, cfg, now);
}

/** Même texte posté par plusieurs comptes en peu de temps : raid coordonné. */
async function checkDuplicates(message: GuildMessage, cfg: GuildConfig, now: number): Promise<boolean> {
  if (cfg.spamDuplicateAccounts <= 1) return false;
  const fingerprint = contentFingerprint(message.content);
  if (fingerprint.length < DUPLICATE_MIN_LENGTH) return false;

  const key = `${message.guildId}:${fingerprint}`;
  const entries = (duplicates.get(key) ?? []).filter((e) => now - e.at < DUPLICATE_WINDOW_MS);
  entries.push({ userId: message.author.id, channelId: message.channelId, messageId: message.id, at: now });
  duplicates.set(key, entries);

  const authors = new Set(entries.map((e) => e.userId));
  if (authors.size < cfg.spamDuplicateAccounts) return false;
  duplicates.delete(key);

  let deleted = 0;
  for (const entry of entries) {
    const channel = message.guild.channels.cache.get(entry.channelId);
    if (!channel?.isTextBased()) continue;
    const ok = await channel.messages
      .delete(entry.messageId)
      .then(() => true)
      .catch(() => false);
    if (ok) deleted++;
  }
  const timedOut: string[] = [];
  for (const userId of authors) {
    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (!member || (await isTrusted(message.guild, userId))) continue;
    const minutes = await timeoutMember(member, cfg.spamTimeoutMinutes, "Anti-spam : raid coordonné");
    if (minutes) timedOut.push(userId);
  }

  await recordIncident(message.guild, {
    type: "raid-coordonne",
    actorId: null,
    summary: `Le même texte a été posté par ${authors.size} comptes en moins de ${DUPLICATE_WINDOW_MS / 1_000} s :\n${trim(message.content, 300)}`,
    measures: [
      `${deleted} message(s) supprimé(s)`,
      `${timedOut.length} compte(s) exclu(s) : ${timedOut.map((id) => `<@${id}>`).join(" ") || "aucun"}`,
    ],
    restore: timedOut.length ? { timeouts: timedOut } : undefined,
  });
  return true;
}

/** Purge des fenêtres échues (job) : ces cartes ne doivent pas grossir sans fin. */
export function pruneSpamState(): void {
  const now = Date.now();
  for (const [key, stamps] of floods) if (stamps.every((at) => now - at > 60_000)) floods.delete(key);
  for (const [key, entries] of duplicates)
    if (entries.every((e) => now - e.at > DUPLICATE_WINDOW_MS)) duplicates.delete(key);
}
