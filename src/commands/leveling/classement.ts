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
    // La page se construit à partir de la base : différer, sinon une requête
    // lente dépasse les 3 s d'accusé de réception de Discord.
    await interaction.deferReply();
    const { embed, row } = await buildLeaderboardPage(interaction.guild, page);
    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};

export default classement;
