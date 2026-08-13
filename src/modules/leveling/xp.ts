import type { Guild, GuildMember, Message } from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botLevels } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { levelFromXp } from "./formula";
import { applyLevelRoles } from "./rewards";

/** Cooldown en mémoire (clé "guildId:userId" → timestamp du dernier gain). */
const cooldowns = new Map<string, number>();

/**
 * Purge des cooldowns expirés : une entrée est créée par membre qui parle et
 * n'était jamais retirée — sur un process qui tourne des mois, la table ne
 * fait que croître. Appelé par le job `xp-cooldowns` (cf. `events/ready.ts`).
 */
export function pruneXpCooldowns(maxAgeMs = 3_600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [key, at] of cooldowns) {
    if (at < cutoff) {
      cooldowns.delete(key);
      removed += 1;
    }
  }
  return removed;
}

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
  });
}

interface GrantXpOptions {
  cfg: GuildConfig;
  fromMessage?: boolean;
  fromVoiceMinute?: boolean;
}

/**
 * Crédite de l'XP et gère le passage de niveau : annonce en message privé
 * (jamais dans un salon du serveur) puis rôles récompense, avec un message
 * privé supplémentaire pour chaque grade obtenu.
 */
export async function grantXp(
  guild: Guild,
  userId: string,
  amount: number,
  opts: GrantXpOptions,
): Promise<void> {
  await grantXpMany(guild, [userId], amount, opts);
}

/**
 * Même chose pour plusieurs membres du même montant, en un seul upsert : le
 * job d'XP vocal crédite tout un salon à la minute et faisait sinon un
 * aller-retour Neon par personne connectée.
 */
export async function grantXpMany(
  guild: Guild,
  userIds: string[],
  amount: number,
  opts: GrantXpOptions,
): Promise<void> {
  // Postgres refuse deux fois la même ligne dans un ON CONFLICT DO UPDATE.
  const targets = [...new Set(userIds)];
  if (!targets.length) return;

  const now = new Date();
  const rows = await db
    .insert(botLevels)
    .values(
      targets.map((userId) => ({
        guildId: guild.id,
        userId,
        xp: amount,
        level: levelFromXp(amount),
        messageCount: opts.fromMessage ? 1 : 0,
        voiceMinutes: opts.fromVoiceMinute ? 1 : 0,
        lastMessageXpAt: opts.fromMessage ? now : null,
      })),
    )
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
        lastMessageXpAt: opts.fromMessage ? now : undefined,
      },
    })
    .returning();

  for (const row of rows) {
    const newLevel = levelFromXp(row.xp);
    if (newLevel <= row.level) continue;
    await announceLevelUp(guild, row.userId, newLevel, opts.cfg).catch((err) =>
      logger.warn(
        { err, guildId: guild.id, userId: row.userId },
        "Passage de niveau non annoncé",
      ),
    );
  }
}

/** Enregistre le nouveau niveau, prévient le membre et applique ses grades. */
async function announceLevelUp(
  guild: Guild,
  userId: string,
  newLevel: number,
  cfg: GuildConfig,
): Promise<void> {
  await db
    .update(botLevels)
    .set({ level: newLevel })
    .where(and(eq(botLevels.guildId, guild.id), eq(botLevels.userId, userId)));

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  // Annonce du passage de niveau, en privé
  const content = cfg.levelupMessage
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{level}", String(newLevel))
    .replaceAll("{server}", guild.name);
  await sendDm(member, content);

  // Rôles récompense : un message privé par grade obtenu
  for (const { role, level } of await applyLevelRoles(member, newLevel)) {
    await sendDm(
      member,
      `🏅 Nouveau grade débloqué : **${role.name}** (niveau **${level}**) !`,
    );
  }
}

/** Envoie un message privé signé du serveur ; échoue silencieusement si MP fermés. */
async function sendDm(member: GuildMember, description: string): Promise<void> {
  const embed = brandEmbed()
    .setAuthor({
      name: member.guild.name,
      iconURL: member.guild.iconURL() ?? undefined,
    })
    .setDescription(description);

  await member.send({ embeds: [embed] }).catch((err) => {
    logger.debug(
      { err, userId: member.id },
      "Message privé de niveau impossible (MP fermés ?)",
    );
  });
}
