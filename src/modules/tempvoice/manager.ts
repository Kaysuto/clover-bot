import {
  ChannelType,
  type Guild,
  type GuildMember,
  PermissionFlagsBits,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botTempVoice } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";

export type TempVoiceRow = typeof botTempVoice.$inferSelect;

export async function getTempVoiceRow(
  voiceChannelId: string,
): Promise<TempVoiceRow | null> {
  const [row] = await db
    .select()
    .from(botTempVoice)
    .where(eq(botTempVoice.voiceChannelId, voiceChannelId))
    .limit(1);
  return row ?? null;
}

function commandsEmbed(owner: GuildMember) {
  return brandEmbed()
    .setTitle("🔊 Ton vocal temporaire est prêt !")
    .setDescription(
      [
        `Bienvenue ${owner} ! Ce salon textuel est réservé aux membres de ton vocal.`,
        "Le vocal et ce salon seront **supprimés automatiquement** quand le vocal sera vide.",
        "",
        "**Commandes de gestion (propriétaire uniquement) :**",
        "· `/voc verrouiller` — empêcher de nouvelles personnes de rejoindre",
        "· `/voc deverrouiller` — rouvrir le vocal à tous",
        "· `/voc limite nombre:<0-99>` — limiter le nombre de places (0 = illimité)",
        "· `/voc renommer nom:<texte>` — renommer le vocal",
        "· `/voc expulser membre:<@membre>` — expulser quelqu'un du vocal",
        "· `/voc transferer membre:<@membre>` — donner la propriété du vocal",
        "· `/voc claim` — récupérer la propriété si le propriétaire est parti",
      ].join("\n"),
    );
}

/** Réagit aux mouvements vocaux : création via le hub, accès au salon texte, nettoyage. */
export async function handleTempVoiceUpdate(
  client: CloverClient,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  if (oldState.channelId === newState.channelId) return; // mute/deaf only

  // ── Arrivée dans un salon ──
  if (newState.channelId && newState.member && !newState.member.user.bot) {
    const cfg = await getGuildConfig(newState.guild.id);
    if (cfg.tempvoiceHubId && newState.channelId === cfg.tempvoiceHubId) {
      await createTempVoice(client, newState.member, cfg).catch((err) =>
        logger.error({ err }, "Création du vocal temporaire impossible"),
      );
    } else {
      const row = await getTempVoiceRow(newState.channelId);
      if (row) await grantTextAccess(newState.guild, row, newState.member);
    }
  }

  // ── Départ d'un salon ──
  if (oldState.channelId) {
    const row = await getTempVoiceRow(oldState.channelId);
    if (row) {
      const channel = oldState.guild.channels.cache.get(oldState.channelId) as
        | VoiceChannel
        | undefined;
      const humans = channel
        ? channel.members.filter((m) => !m.user.bot).size
        : 0;
      if (!channel || humans === 0) {
        await deleteTempVoice(oldState.guild, row);
      } else if (oldState.member && oldState.member.id !== row.ownerId) {
        await revokeTextAccess(oldState.guild, row, oldState.member);
      }
    }
  }
}

async function createTempVoice(
  client: CloverClient,
  member: GuildMember,
  cfg: GuildConfig,
): Promise<void> {
  const guild = member.guild;

  const voice = await guild.channels.create({
    name: `🔊 Vocal de ${member.displayName}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: cfg.tempvoiceCategoryId ?? undefined,
    reason: `Vocal temporaire de ${member.user.tag}`,
    permissionOverwrites: [
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
        ],
      },
    ],
  });

  const text = await guild.channels.create({
    name: `💬-${member.displayName}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: cfg.tempvoiceCategoryId ?? undefined,
    reason: `Salon texte du vocal temporaire de ${member.user.tag}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: client.user!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
  });

  await db.insert(botTempVoice).values({
    voiceChannelId: voice.id,
    guildId: guild.id,
    textChannelId: text.id,
    ownerId: member.id,
  });

  // Déplacer le membre depuis le hub ; s'il est déjà parti, on nettoie tout.
  try {
    await member.voice.setChannel(voice, "Vocal temporaire créé");
  } catch {
    await voice.delete().catch(() => undefined);
    await text.delete().catch(() => undefined);
    await db
      .delete(botTempVoice)
      .where(eq(botTempVoice.voiceChannelId, voice.id));
    return;
  }

  await text
    .send({ content: `${member}`, embeds: [commandsEmbed(member)] })
    .catch(() => undefined);
}

export async function deleteTempVoice(
  guild: Guild,
  row: TempVoiceRow,
): Promise<void> {
  const voice = guild.channels.cache.get(row.voiceChannelId);
  const text = guild.channels.cache.get(row.textChannelId);
  await voice?.delete("Vocal temporaire vide").catch(() => undefined);
  await text?.delete("Vocal temporaire vide").catch(() => undefined);
  await db
    .delete(botTempVoice)
    .where(eq(botTempVoice.voiceChannelId, row.voiceChannelId));
}

async function grantTextAccess(
  guild: Guild,
  row: TempVoiceRow,
  member: GuildMember,
): Promise<void> {
  const text = guild.channels.cache.get(row.textChannelId);
  if (!text || text.type !== ChannelType.GuildText) return;
  await text.permissionOverwrites
    .edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    })
    .catch(() => undefined);
}

async function revokeTextAccess(
  guild: Guild,
  row: TempVoiceRow,
  member: GuildMember,
): Promise<void> {
  const text = guild.channels.cache.get(row.textChannelId);
  if (!text || text.type !== ChannelType.GuildText) return;
  await text.permissionOverwrites.delete(member.id).catch(() => undefined);
}

/**
 * Nettoyage au démarrage : lignes orphelines, vocaux vides restés après un
 * crash, et salons de la catégorie tempvoice sans ligne en base.
 */
export async function cleanupTempVoice(client: CloverClient): Promise<void> {
  const rows = await db.select().from(botTempVoice);

  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) {
      await db
        .delete(botTempVoice)
        .where(eq(botTempVoice.voiceChannelId, row.voiceChannelId));
      continue;
    }
    const voice = await guild.channels
      .fetch(row.voiceChannelId)
      .catch(() => null);
    if (!voice || voice.type !== ChannelType.GuildVoice) {
      await deleteTempVoice(guild, row); // supprime aussi le salon texte + la ligne
      continue;
    }
    const humans = (voice as VoiceChannel).members.filter(
      (m) => !m.user.bot,
    ).size;
    if (humans === 0) await deleteTempVoice(guild, row);
  }

  // Salons orphelins dans la catégorie dédiée (créés juste avant un crash)
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.tempvoiceCategoryId) continue;

    const knownIds = new Set(
      (await db.select().from(botTempVoice)).flatMap((r) => [
        r.voiceChannelId,
        r.textChannelId,
      ]),
    );

    for (const channel of guild.channels.cache.values()) {
      if (channel.parentId !== cfg.tempvoiceCategoryId) continue;
      if (channel.id === cfg.tempvoiceHubId || knownIds.has(channel.id)) continue;
      if (
        channel.type === ChannelType.GuildVoice &&
        channel.members.filter((m) => !m.user.bot).size > 0
      ) {
        continue; // ne jamais couper un vocal occupé
      }
      await channel
        .delete("Salon temporaire orphelin")
        .catch(() => undefined);
    }
  }
}
