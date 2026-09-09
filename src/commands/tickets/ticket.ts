import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from "discord.js";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import {
  buildTicketPanel,
  canManageTicket,
  closeTicket,
  getTicketByChannel,
} from "../../modules/tickets/manager";
import type { Command } from "../../types";

const ticket: Command = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Système de tickets")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Publier le panneau d'ouverture de tickets (admin)")
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon du panneau (défaut : salon courant)")
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Ajouter un membre au ticket")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre à ajouter").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Retirer un membre du ticket")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre à retirer").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("close")
        .setDescription("Fermer ce ticket")
        .addStringOption((o) =>
          o.setName("raison").setDescription("Raison de la fermeture").setMaxLength(500),
        ),
    ),
  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    // Publication du panneau, lecture du ticket en base, réécriture des
    // permissions, archivage : chaque branche fait au moins un aller-retour
    // avant de pouvoir répondre, donc au-delà des 3 s d'accusé de réception de
    // Discord. Différé éphémère : ce qui doit rester visible du salon est
    // publié par `channel.send`.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === "setup") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.editReply({
          embeds: [errorEmbed("Réservé aux administrateurs.")],
        });
        return;
      }
      const channelOption = interaction.options.getChannel("salon");
      const channel = (
        channelOption
          ? await interaction.guild.channels.fetch(channelOption.id)
          : interaction.channel
      ) as TextChannel | null;
      if (!channel) {
        await interaction.editReply({
          embeds: [errorEmbed("Salon introuvable.")],
        });
        return;
      }
      const panel = await channel.send(buildTicketPanel());
      await updateGuildConfig(interaction.guildId, {
        ticketPanelChannelId: channel.id,
        ticketPanelMessageId: panel.id,
      });
      await interaction.editReply({
        embeds: [successEmbed(`Panneau de tickets publié dans ${channel}.`)],
      });
      return;
    }

    // add / remove / close : uniquement dans un salon ticket
    const row = await getTicketByChannel(interaction.channelId);
    if (!row || row.status === "CLOSED") {
      await interaction.editReply({
        embeds: [errorEmbed("Cette commande s'utilise dans un salon ticket ouvert.")],
      });
      return;
    }

    // Même contrôle que les boutons du ticket : auteur, rôle support ou ManageGuild.
    const cfg = await getGuildConfig(interaction.guildId);
    if (!canManageTicket(interaction.member, cfg, row)) {
      await interaction.editReply({
        embeds: [errorEmbed("Seuls l'auteur du ticket et le staff peuvent gérer ce ticket.")],
      });
      return;
    }

    const channel = interaction.channel as TextChannel;

    if (sub === "add" || sub === "remove") {
      const member = interaction.options.getMember("membre");
      if (!member) {
        await interaction.editReply({
          embeds: [errorEmbed("Membre introuvable sur ce serveur.")],
        });
        return;
      }
      // L'arrivée et le départ d'un participant restent visibles du salon : le
      // différé étant éphémère, l'annonce passe par le salon lui-même.
      if (sub === "add") {
        await channel.permissionOverwrites.edit(member.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
        await channel.send({
          embeds: [successEmbed(`${member} a été ajouté au ticket.`)],
        });
      } else {
        if (member.id === row.openerId) {
          await interaction.editReply({
            embeds: [errorEmbed("Impossible de retirer l'auteur du ticket.")],
          });
          return;
        }
        await channel.permissionOverwrites.delete(member.id);
        await channel.send({
          embeds: [successEmbed(`${member.displayName} a été retiré du ticket.`)],
        });
      }
      await interaction.editReply({ content: "C'est fait." });
      return;
    }

    // close
    await interaction.editReply({
      embeds: [successEmbed("Fermeture du ticket, archivage en cours… 🔒")],
    });
    const closed = await closeTicket(
      client,
      channel,
      row,
      interaction.user.id,
      interaction.options.getString("raison"),
    );
    if (!closed.ok) {
      // Le salon existe toujours (fermeture abandonnée) : on remplace l'accusé
      // de réception par la raison de l'échec.
      await interaction.editReply({ embeds: [errorEmbed(closed.error)] });
    }
  },
};

export default ticket;
