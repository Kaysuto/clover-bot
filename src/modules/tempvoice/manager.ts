import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
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
import { buildId } from "../../lib/ids";
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

/** Résolution depuis le salon texte : point d'entrée des boutons de gestion. */
export async function getTempVoiceRowByText(
  textChannelId: string,
): Promise<TempVoiceRow | null> {
  const [row] = await db
    .select()
    .from(botTempVoice)
    .where(eq(botTempVoice.textChannelId, textChannelId))
    .limit(1);
  return row ?? null;
}

/**
 * Panneau de gestion : l'embed affiche l'état courant (propriétaire, verrou,
 * places) et les boutons s'adaptent — pas de « Verrouiller » sur un vocal déjà
 * verrouillé.
 */
function panelEmbed(client: Client, owner: GuildMember | null, row: TempVoiceRow) {
  const embed = brandEmbed()
    .setAuthor({
      name: "Clover Games · Vocaux temporaires",
      iconURL: client.user?.displayAvatarURL({ size: 128 }),
    })
    .setTitle(`🔊 Vocal de ${owner?.displayName ?? "—"}`)
    .setDescription(
      [
        "> Ce salon textuel est **privé** : seuls les membres de ton vocal le voient.",
        "> Le vocal et ce salon sont **supprimés automatiquement** dès que le vocal se vide.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "👑 Propriétaire",
        value: owner ? `<@${owner.id}>` : "*parti — « Réclamer » est ouvert*",
        inline: true,
      },
      {
        name: "🔒 Accès",
        value: row.locked ? "Verrouillé" : "Ouvert à tous",
        inline: true,
      },
      {
        name: "🔢 Places",
        value: row.userLimit === 0 ? "Illimité" : `${row.userLimit}`,
        inline: true,
      },
    )
    .setFooter({
      text: "Boutons réservés au propriétaire — sauf Réclamer, s'il a quitté le vocal. Mêmes actions en /voc",
    });

  if (owner) embed.setThumbnail(owner.displayAvatarURL({ size: 128 }));
  return embed;
}

/** Boutons de gestion, publiés sous l'embed du salon texte. */
export function buildVoiceControls(
  row: TempVoiceRow,
): ActionRowBuilder<ButtonBuilder>[] {
  const button = (
    action: string,
    label: string,
    emoji: string,
    style: ButtonStyle,
    disabled = false,
  ) =>
    new ButtonBuilder()
      .setCustomId(buildId("voc", action))
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(style)
      .setDisabled(disabled);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("lock", "Verrouiller", "🔒", ButtonStyle.Secondary, row.locked),
      button("unlock", "Déverrouiller", "🔓", ButtonStyle.Secondary, !row.locked),
      button("limit", "Places", "🔢", ButtonStyle.Secondary),
      button("rename", "Renommer", "✏️", ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("kick", "Expulser", "👢", ButtonStyle.Danger),
      button("transfer", "Transférer", "👑", ButtonStyle.Primary),
      button("claim", "Réclamer", "🙋", ButtonStyle.Success),
    ),
  ];
}

/**
 * Met le panneau du salon texte à l'état courant. Trois cas couverts :
 * le panneau connu (édition), un vocal antérieur aux boutons ou dont la ligne a
 * perdu la référence (on adopte le message d'accueil du bot), et un panneau
 * supprimé (republication).
 */
export async function ensureVoicePanel(
  guild: Guild,
  row: TempVoiceRow,
): Promise<void> {
  const text = guild.channels.cache.get(row.textChannelId);
  if (!text?.isTextBased()) return;

  let message = row.panelMessageId
    ? await text.messages.fetch(row.panelMessageId).catch(() => null)
    : null;

  if (!message) {
    // Le message d'accueil est le premier du salon, et le bot en est l'auteur.
    const oldest = await text.messages
      .fetch({ limit: 5, after: "0" })
      .catch(() => null);
    message = oldest?.find((m) => m.author.id === guild.client.user.id) ?? null;
  }

  const owner = await guild.members.fetch(row.ownerId).catch(() => null);
  const payload = {
    embeds: [panelEmbed(guild.client, owner, row)],
    components: buildVoiceControls(row),
  };

  const panel = message
    ? await message.edit(payload).catch(() => null)
    : await text.send(payload).catch(() => null);
  if (!panel) {
    logger.debug(
      { voiceChannelId: row.voiceChannelId },
      "Panneau vocal non actualisé",
    );
    return;
  }

  if (panel.id !== row.panelMessageId) {
    await db
      .update(botTempVoice)
      .set({ panelMessageId: panel.id })
      .where(eq(botTempVoice.voiceChannelId, row.voiceChannelId));
  }
}

/**
 * Réactualise le panneau après un changement d'état (verrou, places,
 * propriétaire). Relit la ligne : l'action vient peut-être d'une autre voie
 * (`/voc`) que le clic sur les boutons.
 */
export async function refreshVoicePanel(
  guild: Guild,
  voiceChannelId: string,
): Promise<void> {
  const row = await getTempVoiceRow(voiceChannelId);
  if (row) await ensureVoicePanel(guild, row);
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

  const [row] = await db
    .insert(botTempVoice)
    .values({
      voiceChannelId: voice.id,
      guildId: guild.id,
      textChannelId: text.id,
      ownerId: member.id,
    })
    .returning();

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

  if (!row) return;

  const panel = await text
    .send({
      content: `${member}`,
      embeds: [panelEmbed(client, member, row)],
      components: buildVoiceControls(row),
    })
    .catch(() => null);

  // L'identifiant du panneau permet de le réactualiser à chaque changement.
  if (panel) {
    await db
      .update(botTempVoice)
      .set({ panelMessageId: panel.id })
      .where(eq(botTempVoice.voiceChannelId, voice.id));
  }
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
    if (humans === 0) {
      await deleteTempVoice(guild, row);
      continue;
    }
    // Vocal toujours occupé : son panneau est remis au format courant, ce qui
    // rattrape ceux créés avant l'ajout des boutons.
    await ensureVoicePanel(guild, row).catch((err) =>
      logger.debug(
        { err, voiceChannelId: row.voiceChannelId },
        "Panneau vocal non actualisé au démarrage",
      ),
    );
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
