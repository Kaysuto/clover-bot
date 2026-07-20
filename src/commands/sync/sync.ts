import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { env } from "../../config";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { syncGuild, syncMember } from "../../modules/sync/manager";
import type { Command } from "../../types";

const WEBSITE_PROFILE = `${env.WEBSITE_URL.replace(/\/$/, "")}/profil`;

const sync: Command = {
  data: new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Synchronisation Discord ↔ Minecraft")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName("moi")
        .setDescription("Synchronise ton pseudo avec ton compte Minecraft lié"),
    )
    .addSubcommand((s) =>
      s
        .setName("membre")
        .setDescription("Synchronise un membre (staff)")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre à synchroniser").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("tout")
        .setDescription("Synchronise tous les membres du serveur (admin)"),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "tout") {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          embeds: [errorEmbed("Réservé aux administrateurs.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await syncGuild(interaction.guild);
      await interaction.editReply({
        embeds: [
          successEmbed(
            `Synchronisation terminée : **${result.synced}** synchronisé(s), **${result.partial}** partiel(s), **${result.unlinked}** non lié(s).`,
          ),
        ],
      });
      return;
    }

    let target = interaction.member;
    if (sub === "membre") {
      if (
        !interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)
      ) {
        await interaction.reply({
          embeds: [errorEmbed("Réservé au staff (permission « Gérer les pseudos »).")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const member = interaction.options.getMember("membre");
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed("Membre introuvable sur ce serveur.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      target = member;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await syncMember(target);

    if (result.status === "not-linked") {
      const who =
        target.id === interaction.user.id
          ? "Tu n'as pas encore lié ton compte Minecraft."
          : `${target.displayName} n'a pas de compte Minecraft lié.`;
      await interaction.editReply({
        embeds: [
          errorEmbed(`${who}\n👉 Lie ton compte sur ${WEBSITE_PROFILE}`),
        ],
      });
      return;
    }

    const suffix =
      result.status === "partial"
        ? "\n⚠️ Certaines actions ont échoué (pseudo du propriétaire du serveur ou rôle au-dessus du bot)."
        : "";
    await interaction.editReply({
      embeds: [
        successEmbed(
          `Pseudo synchronisé : **${result.username}**${suffix}`,
        ),
      ],
    });
  },
};

export default sync;
