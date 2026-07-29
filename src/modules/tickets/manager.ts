import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type GuildTextBasedChannel,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
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

interface TicketCategory {
  label: string;
  emoji: string;
  /** Description affichée sous l'option du menu déroulant (100 car. max). */
  hint: string;
}

export const TICKET_CATEGORIES: Record<string, TicketCategory> = {
  support: {
    label: "Support",
    emoji: "🛠️",
    hint: "Bug, connexion impossible, question sur le serveur",
  },
  signalement: {
    label: "Signalement",
    emoji: "🚨",
    hint: "Triche, comportement d'un joueur, litige",
  },
  boutique: {
    label: "Boutique",
    emoji: "🛒",
    hint: "Achat, don, grade ou récompense non reçu",
  },
  autre: {
    label: "Autre",
    emoji: "💬",
    hint: "Tout ce qui n'entre dans aucune autre case",
  },
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
export function buildTicketPanel(client: CloverClient) {
  const embed = brandEmbed()
    .setAuthor({
      name: "Clover Games · Support",
      iconURL: client.user?.displayAvatarURL({ size: 128 }),
    })
    .setTitle("🎫 Ouvrir un ticket")
    .setDescription(
      [
        "> Un salon privé sera créé entre toi et l'équipe.",
        "> Tu y suis ta demande jusqu'à sa résolution.",
        "",
        "**Catégories disponibles**",
        Object.values(TICKET_CATEGORIES)
          .map((c) => `${c.emoji} ${c.label}`)
          .join("  ·  "),
      ].join("\n"),
    )
    .setFooter({
      text: "Un seul ticket ouvert à la fois • Ne partage jamais ton mot de passe",
    });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId("ticket", "open"))
    .setPlaceholder("Choisis la catégorie de ta demande…")
    .addOptions(
      Object.entries(TICKET_CATEGORIES).map(([key, c]) => ({
        value: key,
        label: c.label,
        description: c.hint,
        emoji: c.emoji,
      })),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ],
  };
}

export const handleTicketComponent: ComponentHandler = async (
  interaction,
  action,
  args,
  client,
) => {
  switch (action) {
    case "open": {
      if (interaction.isModalSubmit()) return;
      // Menu déroulant du panneau ; `args[0]` couvre les panneaux à boutons
      // publiés avant, tant qu'ils n'ont pas été republiés.
      const category = interaction.isStringSelectMenu()
        ? (interaction.values[0] ?? "support")
        : (args[0] ?? "support");
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

      // Le menu resterait affiché sur l'option choisie : on réédite le panneau
      // pour le remettre à zéro (impossible via la réponse, déjà consommée par
      // la modale — d'où l'édition directe du message).
      if (interaction.isStringSelectMenu()) {
        await interaction.message
          .edit(buildTicketPanel(client))
          .catch((err) =>
            logger.debug({ err }, "Réinitialisation du menu de tickets impossible"),
          );
      }
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
    reason: `Ticket de @${interaction.user.username}`,
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
  // Le sujet sert de titre : c'est ce qu'on lit en premier dans la liste des salons.
  const titleLine = subject.split("\n")[0]?.slice(0, 200) || info.label;
  const welcome = brandEmbed()
    .setAuthor({
      name: `Ticket #${String(num).padStart(4, "0")} · ${info.label}`,
      iconURL: interaction.user.displayAvatarURL({ size: 128 }),
    })
    .setTitle(`${info.emoji} ${titleLine}`)
    .setDescription(
      [
        "> Un membre de l'équipe va te répondre dès que possible.",
        "> Ajoute tout détail utile : captures d'écran, pseudo Minecraft, date et heure.",
      ].join("\n"),
    )
    .addFields(
      { name: "Ouvert par", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Catégorie", value: `${info.emoji} ${info.label}`, inline: true },
      {
        name: "Ouvert",
        value: `<t:${Math.floor(Date.now() / 1_000)}:R>`,
        inline: true,
      },
    )
    .setFooter({ text: "✋ Réclamer : pour l'équipe • 🔒 Fermer : archive et supprime le salon" });

  // Le sujet complet mérite son champ dès qu'il dépasse une ligne de titre.
  if (subject.length > 200 || subject.includes("\n")) {
    welcome.spliceFields(0, 0, { name: "Sujet", value: subject.slice(0, 1024) });
  }

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
