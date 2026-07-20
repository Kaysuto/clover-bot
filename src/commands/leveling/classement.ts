import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { buildLeaderboardPage } from "../../modules/leveling/leaderboard";
import type { Command } from "../../types";

const classement: Command = {
  data: new SlashCommandBuilder()
    .setName("classement")
    .setDescription("Classement des niveaux du serveur")
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o.setName("page").setDescription("Numéro de page").setMinValue(1),
    ),
  async execute(interaction) {
    const page = interaction.options.getInteger("page") ?? 1;
    const { embed, row } = await buildLeaderboardPage(interaction.guild, page);
    await interaction.reply({ embeds: [embed], components: [row] });
  },
};

export default classement;
