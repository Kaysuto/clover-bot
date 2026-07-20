import type { Guild, Message, SendableChannels } from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botLevels } from "../../db/schema";
import { logger } from "../../lib/logger";
import { levelFromXp } from "./formula";
import { applyLevelRoles } from "./rewards";

/** Cooldown en mémoire (clé "guildId:userId" → timestamp du dernier gain). */
const cooldowns = new Map<string, number>();

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Gain d'XP à chaque message (ne nécessite PAS l'intent MessageContent). */
export async function handleMessageXp(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.system) return;

  const cfg = await getGuildConfig(message.guildId);
  if (cfg.noXpChannelIds.includes(message.channelId)) return;

  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (cooldowns.get(key) ?? 0) < cfg.xpCooldownSec * 1_000) return;
  cooldowns.set(key, now);

  const gain = randInt(cfg.xpMin, cfg.xpMax);
  await grantXp(message.guild, message.author.id, gain, {
    cfg,
    fromMessage: true,
    fallbackChannel: message.channel,
  });
}

interface GrantXpOptions {
  cfg: GuildConfig;
  fromMessage?: boolean;
  fromVoiceMinute?: boolean;
  /** Salon d'annonce si aucun salon dédié n'est configuré. */
  fallbackChannel?: SendableChannels | null;
}

/** Crédite de l'XP et gère le passage de niveau (annonce + rôles). */
export async function grantXp(
  guild: Guild,
  userId: string,
  amount: number,
  opts: GrantXpOptions,
): Promise<void> {
  const [row] = await db
    .insert(botLevels)
    .values({
      guildId: guild.id,
      userId,
      xp: amount,
      level: levelFromXp(amount),
      messageCount: opts.fromMessage ? 1 : 0,
      voiceMinutes: opts.fromVoiceMinute ? 1 : 0,
      lastMessageXpAt: opts.fromMessage ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [botLevels.guildId, botLevels.userId],
      set: {
        xp: sql`${botLevels.xp} + ${amount}`,
        messageCount: opts.fromMessage
          ? sql`${botLevels.messageCount} + 1`
          : undefined,
        voiceMinutes: opts.fromVoiceMinute
          ? sql`${botLevels.voiceMinutes} + 1`
          : undefined,
        lastMessageXpAt: opts.fromMessage ? new Date() : undefined,
      },
    })
    .returning();
  if (!row) return;

  const newLevel = levelFromXp(row.xp);
  if (newLevel <= row.level) return;

  await db
    .update(botLevels)
    .set({ level: newLevel })
    .where(and(eq(botLevels.guildId, guild.id), eq(botLevels.userId, userId)));

  // Annonce du passage de niveau
  const announceChannel = resolveAnnounceChannel(guild, opts);
  if (announceChannel) {
    const content = opts.cfg.levelupMessage
      .replaceAll("{user}", `<@${userId}>`)
      .replaceAll("{level}", String(newLevel));
    await announceChannel
      .send({ content, allowedMentions: { users: [userId] } })
      .catch((err) => logger.warn({ err }, "Annonce de niveau impossible"));
  }

  // Rôles récompense
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await applyLevelRoles(member, newLevel);
}

function resolveAnnounceChannel(
  guild: Guild,
  opts: GrantXpOptions,
): SendableChannels | null {
  if (opts.cfg.levelupChannelId) {
    const channel = guild.channels.cache.get(opts.cfg.levelupChannelId);
    if (channel?.isSendable()) return channel;
  }
  return opts.fallbackChannel ?? null;
}
