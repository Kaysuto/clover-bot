import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type GuildTextBasedChannel,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createTranscript } from "discord-html-transcripts";
import { and, eq, ne, sql } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botGuildConfig, botTickets } from "../../db/schema";
import { formatDuration } from "../../lib/duration";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import type { ComponentHandler, ComponentInteraction } from "../../types";

export type TicketRow = typeof botTickets.$inferSelect;

export const TICKET_CATEGORIES: Record<string, { label: string; emoji: string }> =
  {
    support: { label: "Support", emoji: "🛠️" },
    signalement: { label: "Signalement", emoji: "🚨" },
    boutique: { label: "Boutique", emoji: "🛒" },
    autre: { label: "Autre", emoji: "💬" },
  };

function ticketName(num: number): string {
  return `ticket-${String(num).padStart(4, "0")}`;
}

export async function getTicketByChannel(
  channelId: string,
): Promise<TicketRow | null> {
  const [row] = await db
    .select()
    .from(botTickets)
    .where(eq(botTickets.channelId, channelId))
    .limit(1);
  return row ?? null;
}

function isSupport(
  interaction: ComponentInteraction,
  cfg: GuildConfig,
): boolean {
  return (
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (cfg.ticketSupportRoleId
      ? interaction.member.roles.cache.has(cfg.ticketSupportRoleId)
      : false)
  );
}

/** Panneau publié par /ticket setup. */
export function buildTicketPanel() {
  const embed = brandEmbed()
    .setTitle("🎫 Besoin d'aide ?")
    .setDescription(
      [
        "Clique sur le bouton correspondant à ta demande pour ouvrir un ticket.",
        "Un salon privé sera créé entre toi et l'équipe.",
        "",
        Object.entries(TICKET_CATEGORIES)
          .map(([, v]) => `${v.emoji} **${v.label}**`)
          .join(" · "),
      ].join("\n"),
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...Object.entries(TICKET_CATEGORIES).map(([key, v]) =>
      new ButtonBuilder()
        .setCustomId(buildId("ticket", "open", key))
        .setLabel(v.label)
        .setEmoji(v.emoji)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: [row] };
}

export const handleTicketComponent: ComponentHandler = async (
  interaction,
  action,
  args,
  client,
) => {
  switch (action) {
    case "open": {
      if (!interaction.isButton()) return;
      const category = args[0] ?? "support";
      const modal = new ModalBuilder()
        .setCustomId(buildId("ticket", "modal", category))
        .setTitle(`Ticket — ${TICKET_CATEGORIES[category]?.label ?? "Support"}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("subject")
              .setLabel("Sujet de ta demande")
              .setPlaceholder("Décris brièvement ton problème…")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    case "modal": {
      if (!interaction.isModalSubmit()) return;
      await createTicket(
        interaction,
        client,
        args[0] ?? "support",
        interaction.fields.getTextInputValue("subject"),
      );
      return;
    }
    case "claim": {
      if (!interaction.isButton()) return;
      await claimTicket(interaction);
      return;
    }
    case "close": {
      if (!interaction.isButton()) return;
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId("ticket", "closeok"))
          .setLabel("Confirmer la fermeture")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger),
      );
      await interaction.reply({
        embeds: [
          brandEmbed().setDescription(
            "⚠️ Fermer ce ticket ? Un transcript sera archivé puis le salon sera **supprimé**.",
          ),
        ],
        components: [confirmRow],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "closeok": {
      if (!interaction.isButton()) return;
      const row = await getTicketByChannel(interaction.channelId);
      if (!row || row.status === "CLOSED") {
        await interaction.update({
          embeds: [errorEmbed("Ce ticket est déjà fermé.")],
          components: [],
        });
        return;
      }
      await interaction.update({
        embeds: [brandEmbed().setDescription("🔒 Fermeture du ticket…")],
        components: [],
      });
      await closeTicket(
        client,
        interaction.channel as TextChannel,
        row,
        interaction.user.id,
        null,
      );
      return;
    }
  }
};

async function createTicket(
  interaction: ComponentInteraction,
  client: CloverClient,
  category: string,
  subject: string,
): Promise<void> {
  const guild = interaction.guild;
  const cfg = await getGuildConfig(guild.id);

  if (!cfg.ticketCategoryId || !cfg.ticketArchiveChannelId || !cfg.ticketSupportRoleId) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Le système de tickets n'est pas entièrement configuré (`/config tickets …`).",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 1 ticket ouvert max par utilisateur
  const [existing] = await db
    .select()
    .from(botTickets)
    .where(
      and(
        eq(botTickets.guildId, guild.id),
        eq(botTickets.openerId, interaction.user.id),
        ne(botTickets.status, "CLOSED"),
      ),
    )
    .limit(1);
  if (existing) {
    await interaction.reply({
      embeds: [
        errorEmbed(`Tu as déjà un ticket ouvert : <#${existing.channelId}>.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Numérotation atomique
  const [updated] = await db
    .update(botGuildConfig)
    .set({ ticketCounter: sql`${botGuildConfig.ticketCounter} + 1` })
    .where(eq(botGuildConfig.guildId, guild.id))
    .returning({ n: botGuildConfig.ticketCounter });
  const num = updated?.n ?? 1;

  const channel = await guild.channels.create({
    name: ticketName(num),
    type: ChannelType.GuildText,
    parent: cfg.ticketCategoryId,
    reason: `Ticket de ${interaction.user.tag}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: cfg.ticketSupportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: client.user!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
  });

  await db.insert(botTickets).values({
    guildId: guild.id,
    ticketNumber: num,
    channelId: channel.id,
    openerId: interaction.user.id,
    subject,
    category,
  });

  const info = TICKET_CATEGORIES[category] ?? TICKET_CATEGORIES.support!;
  const welcome = brandEmbed()
    .setTitle(`${info.emoji} Ticket #${String(num).padStart(4, "0")} — ${info.label}`)
    .setDescription(
      [
        `**Sujet :** ${subject}`,
        "",
        "Un membre de l'équipe va te répondre dès que possible.",
        "Ajoute ici tout détail utile (captures d'écran, pseudo Minecraft…).",
      ].join("\n"),
    )
    .setFooter({ text: `Ouvert par ${interaction.user.tag}` })
    .setTimestamp();

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("ticket", "claim"))
      .setLabel("Réclamer")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildId("ticket", "close"))
      .setLabel("Fermer")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `${interaction.user} · <@&${cfg.ticketSupportRoleId}>`,
    embeds: [welcome],
    components: [buttons],
  });

  await interaction.editReply({
    embeds: [successEmbed(`Ton ticket est ouvert : ${channel}`)],
  });
}

async function claimTicket(interaction: ComponentInteraction): Promise<void> {
  const cfg = await getGuildConfig(interaction.guild.id);
  if (!isSupport(interaction, cfg)) {
    await interaction.reply({
      embeds: [errorEmbed("Seule l'équipe support peut réclamer un ticket.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const row = await getTicketByChannel(interaction.channelId!);
  if (!row || row.status === "CLOSED") return;
  if (row.claimedBy) {
    await interaction.reply({
      embeds: [errorEmbed(`Ticket déjà réclamé par <@${row.claimedBy}>.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await db
    .update(botTickets)
    .set({ status: "CLAIMED", claimedBy: interaction.user.id })
    .where(eq(botTickets.id, row.id));

  await interaction.reply({
    embeds: [
      brandEmbed().setDescription(
        `✋ ${interaction.user} prend en charge ce ticket.`,
      ),
    ],
  });
}

/** Ferme un ticket : transcript HTML → salon archive → suppression du salon. */
export async function closeTicket(
  client: CloverClient,
  channel: TextChannel,
  row: TicketRow,
  closedById: string,
  reason: string | null,
): Promise<void> {
  const cfg = await getGuildConfig(row.guildId);
  const info = TICKET_CATEGORIES[row.category] ?? TICKET_CATEGORIES.support!;

  // Transcript HTML complet
  let transcript = null;
  try {
    transcript = await createTranscript(channel, {
      limit: -1,
      filename: `${ticketName(row.ticketNumber)}.html`,
      saveImages: true,
      poweredBy: false,
    });
  } catch (err) {
    logger.error({ err, ticket: row.id }, "Génération du transcript impossible");
  }

  // Archive
  if (cfg.ticketArchiveChannelId) {
    const archive = (await channel.guild.channels
      .fetch(cfg.ticketArchiveChannelId)
      .catch(() => null)) as GuildTextBasedChannel | null;
    if (archive?.isSendable()) {
      const recap = brandEmbed()
        .setTitle(
          `📁 ${ticketName(row.ticketNumber)} — ${info.emoji} ${info.label}`,
        )
        .addFields(
          { name: "Sujet", value: row.subject.slice(0, 1024) },
          { name: "Ouvert par", value: `<@${row.openerId}>`, inline: true },
          {
            name: "Pris en charge par",
            value: row.claimedBy ? `<@${row.claimedBy}>` : "—",
            inline: true,
          },
          { name: "Fermé par", value: `<@${closedById}>`, inline: true },
          {
            name: "Durée",
            value: formatDuration(Date.now() - row.openedAt.getTime()),
            inline: true,
          },
          ...(reason ? [{ name: "Raison", value: reason.slice(0, 1024) }] : []),
        )
        .setTimestamp();
      await archive
        .send({ embeds: [recap], files: transcript ? [transcript] : [] })
        .catch((err) => logger.error({ err }, "Archivage du ticket impossible"));
    }
  }

  await db
    .update(botTickets)
    .set({
      status: "CLOSED",
      closedBy: closedById,
      closeReason: reason,
      closedAt: new Date(),
    })
    .where(eq(botTickets.id, row.id));

  await channel.delete(`Ticket fermé par ${closedById}`).catch((err) =>
    logger.warn({ err }, "Suppression du salon ticket impossible"),
  );
}

/** Au démarrage : les tickets dont le salon a disparu passent CLOSED. */
export async function reconcileTickets(client: CloverClient): Promise<void> {
  const rows = await db
    .select()
    .from(botTickets)
    .where(ne(botTickets.status, "CLOSED"));

  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guildId);
    const channel = guild
      ? await guild.channels.fetch(row.channelId).catch(() => null)
      : null;
    if (channel) continue;
    await db
      .update(botTickets)
      .set({
        status: "CLOSED",
        closeReason: "Salon supprimé manuellement",
        closedAt: new Date(),
      })
      .where(eq(botTickets.id, row.id));
    logger.info({ ticket: row.id }, "Ticket réconcilié (salon disparu)");
  }
}
