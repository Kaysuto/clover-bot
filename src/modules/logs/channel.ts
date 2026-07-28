import type { EmbedBuilder, Guild, SendableChannels } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botLogSettings } from "../../db/schema";
import { logger } from "../../lib/logger";

/** Catégories de logs (clé technique → libellé affiché). */
export const LOG_CATEGORIES = {
  membres: "Membres",
  moderation: "Modération",
  vocal: "Vocal",
  serveur: "Serveur",
} as const;

export type LogCategory = keyof typeof LOG_CATEGORIES;

export const LOG_CATEGORY_KEYS = Object.keys(LOG_CATEGORIES) as LogCategory[];

/**
 * Publie un embed dans le salon de logs de la catégorie.
 * Silencieux si aucun salon n'est configuré ou si la catégorie est désactivée :
 * un log raté ne doit jamais interrompre le traitement de l'événement.
 */
export async function sendLog(
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    const channel = await resolveLogChannel(guild, category);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err, guildId: guild.id, category }, "Publication du log impossible");
  }
}

async function resolveLogChannel(
  guild: Guild,
  category: LogCategory,
): Promise<SendableChannels | null> {
  const [setting] = await db
    .select()
    .from(botLogSettings)
    .where(
      and(eq(botLogSettings.guildId, guild.id), eq(botLogSettings.category, category)),
    );
  if (setting && !setting.enabled) return null;

  const cfg = await getGuildConfig(guild.id);
  const channelId = setting?.channelId ?? cfg.logChannelId;
  if (!channelId) return null;

  const channel = guild.channels.cache.get(channelId);
  return channel?.isSendable() ? channel : null;
}

/** Réglages de toutes les catégories (pour `/config logs voir`). */
export async function getLogSettings(
  guildId: string,
): Promise<(typeof botLogSettings.$inferSelect)[]> {
  return db.select().from(botLogSettings).where(eq(botLogSettings.guildId, guildId));
}

export async function setLogSetting(
  guildId: string,
  category: LogCategory,
  values: { channelId?: string | null; enabled?: boolean },
): Promise<void> {
  await db
    .insert(botLogSettings)
    .values({ guildId, category, ...values })
    .onConflictDoUpdate({
      target: [botLogSettings.guildId, botLogSettings.category],
      set: values,
    });
}
