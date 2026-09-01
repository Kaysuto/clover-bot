import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type GuildMember,
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
import {
  getGuildConfig,
  type GuildConfig,
  invalidateGuildConfig,
} from "../../db/guild-config";
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

/** Données du message d'accueil d'un ticket : `TicketRow` les porte toutes. */
export interface TicketWelcome {
  ticketNumber: number;
  category: string;
  subject: string;
  openerId: string;
  claimedBy: string | null;
  openedAt: Date;
}

/**
 * Message d'accueil publié dans le salon du ticket.
 *
 * Le titre décrit le ticket (numéro et catégorie), jamais le sujet : celui-ci
 * est saisi par le membre, il vit dans son propre champ où il tient en entier.
 */
export function buildTicketWelcome(ticket: TicketWelcome) {
  const info = TICKET_CATEGORIES[ticket.category] ?? TICKET_CATEGORIES.support!;
  const number = String(ticket.ticketNumber).padStart(4, "0");

  const embed = brandEmbed()
    .setTitle(`${info.emoji} Ticket #${number} — ${info.label}`)
    .setDescription(
      [
        "> Un membre de l'équipe va te répondre dès que possible.",
        "> Ajoute tout détail utile : captures d'écran, pseudo Minecraft, date et heure.",
      ].join("\n"),
    )
    .addFields(
      { name: "Sujet", value: ticket.subject.slice(0, 1024) },
      { name: "Ouvert par", value: `<@${ticket.openerId}>`, inline: true },
      {
        name: "Ouvert",
        value: `<t:${Math.floor(ticket.openedAt.getTime() / 1_000)}:R>`,
        inline: true,
      },
      {
        name: "Pris en charge par",
        value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "—",
        inline: true,
      },
    )
    .setFooter({
      text: "✋ Réclamer : pour l'équipe • 🔒 Fermer : archive et supprime le salon",
    });

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

  return { embeds: [embed], components: [buttons] };
}

/**
 * Remet le message d'accueil au format courant (titre, sujet, prise en charge).
 * Il n'est pas référencé en base : c'est le premier message du salon, et
 * `after: "0"` renvoie justement les plus anciens.
 */
export async function refreshTicketWelcome(
  channel: GuildTextBasedChannel,
  botId: string,
  ticket: TicketWelcome,
): Promise<void> {
  const oldest = await channel.messages
    .fetch({ after: "0", limit: 3 })
    .catch(() => null);
  const message = oldest?.find(
    (m) => m.author.id === botId && m.components.length > 0,
  );
  if (!message) return;

  await message
    .edit(buildTicketWelcome(ticket))
    .catch((err: unknown) =>
      logger.warn(
        { err, channelId: channel.id },
        "Actualisation du message d'accueil du ticket impossible",
      ),
    );
}

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

function isSupport(member: GuildMember, cfg: GuildConfig): boolean {
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (cfg.ticketSupportRoleId
      ? member.roles.cache.has(cfg.ticketSupportRoleId)
      : false)
  );
}

/**
 * Contrôle d'accès à la gestion d'un ticket (fermeture, ajout/retrait de
 * membres) : auteur du ticket, rôle support ou permission ManageGuild.
 * Partagé entre la commande slash et les boutons — un membre simplement
 * ajouté au salon ne doit pas pouvoir fermer et supprimer le ticket.
 */
export function canManageTicket(
  member: GuildMember,
  cfg: GuildConfig,
  row: TicketRow,
): boolean {
  return row.openerId === member.id || isSupport(member, cfg);
}

/** Panneau publié par /ticket setup. */
export function buildTicketPanel() {
  const embed = brandEmbed()
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
          .edit(buildTicketPanel())
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
      // Même contrôle que la commande slash : le bouton est visible par tout
      // membre du salon (dont les membres ajoutés via /ticket add).
      const row = await getTicketByChannel(interaction.channelId);
      if (!row || row.status === "CLOSED") {
        await interaction.reply({
          embeds: [errorEmbed("Ce ticket est déjà fermé.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const cfg = await getGuildConfig(interaction.guild.id);
      if (!canManageTicket(interaction.member, cfg, row)) {
        await interaction.reply({
          embeds: [errorEmbed("Seuls l'auteur du ticket et l'équipe support peuvent le fermer.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
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
      // Revérifié ici aussi : c'est ce bouton qui déclenche réellement la
      // fermeture, il ne doit jamais faire confiance à l'étape précédente.
      const cfg = await getGuildConfig(interaction.guild.id);
      if (!canManageTicket(interaction.member, cfg, row)) {
        await interaction.update({
          embeds: [errorEmbed("Seuls l'auteur du ticket et l'équipe support peuvent le fermer.")],
          components: [],
        });
        return;
      }
      await interaction.update({
        embeds: [brandEmbed().setDescription("🔒 Fermeture du ticket…")],
        components: [],
      });
      const closed = await closeTicket(
        client,
        interaction.channel as TextChannel,
        row,
        interaction.user.id,
        null,
      );
      if (!closed.ok) {
        await interaction.followUp({
          embeds: [errorEmbed(closed.error)],
          flags: MessageFlags.Ephemeral,
        });
      }
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

  // Numérotation atomique (hors updateGuildConfig, qui écraserait l'incrément
  // par une valeur lue avant : d'où l'invalidation manuelle du cache).
  const [updated] = await db
    .update(botGuildConfig)
    .set({ ticketCounter: sql`${botGuildConfig.ticketCounter} + 1` })
    .where(eq(botGuildConfig.guildId, guild.id))
    .returning({ n: botGuildConfig.ticketCounter });
  invalidateGuildConfig(guild.id);
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

  await channel.send({
    content: `${interaction.user} · <@&${cfg.ticketSupportRoleId}>`,
    ...buildTicketWelcome({
      ticketNumber: num,
      category,
      subject,
      openerId: interaction.user.id,
      claimedBy: null,
      openedAt: new Date(),
    }),
  });

  await interaction.editReply({
    embeds: [successEmbed(`Ton ticket est ouvert : ${channel}`)],
  });
}

async function claimTicket(interaction: ComponentInteraction): Promise<void> {
  const cfg = await getGuildConfig(interaction.guild.id);
  if (!isSupport(interaction.member, cfg)) {
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

  if (interaction.channel?.isTextBased()) {
    await refreshTicketWelcome(interaction.channel, interaction.client.user.id, {
      ...row,
      claimedBy: interaction.user.id,
    });
  }

  await interaction.reply({
    embeds: [
      brandEmbed().setDescription(
        `✋ ${interaction.user} prend en charge ce ticket.`,
      ),
    ],
  });
}

export type CloseTicketResult = { ok: true } | { ok: false; error: string };

/**
 * Ferme un ticket : transcript HTML → salon archive → suppression du salon.
 *
 * La fermeture est abandonnée (le ticket reste ouvert, le salon intact) si le
 * transcript ne peut pas être généré ou si l'archive ne peut pas le recevoir :
 * le salon est la seule copie de l'échange, le supprimer sans archive
 * détruirait l'historique. En dernier recours, supprimer le salon à la main —
 * reconcileTickets marquera le ticket CLOSED au démarrage suivant.
 */
export async function closeTicket(
  client: CloverClient,
  channel: TextChannel,
  row: TicketRow,
  closedById: string,
  reason: string | null,
): Promise<CloseTicketResult> {
  const cfg = await getGuildConfig(row.guildId);
  const info = TICKET_CATEGORIES[row.category] ?? TICKET_CATEGORIES.support!;

  // Transcript HTML complet — obligatoire avant toute suppression.
  let transcript;
  try {
    transcript = await createTranscript(channel, {
      limit: -1,
      filename: `${ticketName(row.ticketNumber)}.html`,
      saveImages: true,
      poweredBy: false,
    });
  } catch (err) {
    logger.error(
      { err, ticket: row.id },
      "Génération du transcript impossible — fermeture abandonnée",
    );
    return {
      ok: false,
      error:
        "La génération du transcript a échoué : le ticket reste ouvert. Réessaie dans quelques instants.",
    };
  }

  // Archive — elle aussi obligatoire.
  if (!cfg.ticketArchiveChannelId) {
    return {
      ok: false,
      error:
        "Aucun salon d'archives n'est configuré (`/config tickets …`) : le ticket reste ouvert pour ne pas perdre le transcript.",
    };
  }
  const archive = (await channel.guild.channels
    .fetch(cfg.ticketArchiveChannelId)
    .catch(() => null)) as GuildTextBasedChannel | null;
  if (!archive?.isSendable()) {
    return {
      ok: false,
      error:
        "Le salon d'archives est introuvable ou inaccessible : le ticket reste ouvert pour ne pas perdre le transcript.",
    };
  }

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

  try {
    await archive.send({ embeds: [recap], files: [transcript] });
  } catch (err) {
    logger.error(
      { err, ticket: row.id },
      "Archivage du ticket impossible — fermeture abandonnée",
    );
    return {
      ok: false,
      error:
        "L'envoi du transcript dans les archives a échoué : le ticket reste ouvert.",
    };
  }

  // L'archive est en sécurité : on peut clôturer puis supprimer le salon.
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

  return { ok: true };
}

/**
 * Au démarrage : remet le panneau publié au format courant (menu déroulant,
 * libellés…). Sans ça, un panneau publié par une ancienne version resterait
 * tel quel jusqu'à un `/ticket setup` manuel.
 */
export async function refreshTicketPanels(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.ticketPanelChannelId || !cfg.ticketPanelMessageId) continue;

    const channel = await guild.channels
      .fetch(cfg.ticketPanelChannelId)
      .catch(() => null);
    if (!channel?.isTextBased()) continue;

    const message = await channel.messages
      .fetch(cfg.ticketPanelMessageId)
      .catch(() => null);
    if (!message) {
      logger.warn(
        { guildId: guild.id },
        "Panneau de tickets introuvable — republier avec /ticket setup",
      );
      continue;
    }

    await message
      .edit(buildTicketPanel())
      .catch((err) => logger.warn({ err }, "Actualisation du panneau de tickets impossible"));
  }
}

/**
 * Au démarrage : les tickets dont le salon a disparu passent CLOSED, les
 * autres voient leur message d'accueil remis au format courant.
 */
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
    if (channel) {
      // Le salon est toujours là : on en profite pour remettre le message
      // d'accueil au format courant (il date de la version qui l'a publié).
      if (channel.isTextBased()) {
        await refreshTicketWelcome(channel, client.user!.id, row);
      }
      continue;
    }
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
