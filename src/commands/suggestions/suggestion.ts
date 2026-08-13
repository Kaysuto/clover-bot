import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { createSuggestion } from "../../modules/suggestions/manager";
import type { Command } from "../../types";

const suggestion: Command = {
  data: new SlashCommandBuilder()
    .setName("suggestion")
    .setDescription("Proposer une idée pour le réseau")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("idee")
        .setDescription("Ton idée, aussi précise que possible")
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(1_000),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await createSuggestion(
      interaction.guild,
      interaction.user,
      interaction.options.getString("idee", true),
    );

    if (!result.ok) {
      await interaction.editReply({ embeds: [errorEmbed(result.error)] });
      return;
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          `Suggestion **#${result.row.id}** publiée dans <#${result.row.channelId}> — merci ! 🍀`,
        ),
      ],
    });
  },
};

export default suggestion;
