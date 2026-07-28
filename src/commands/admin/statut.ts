import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { buildStatusEmbed } from "../../modules/status/monitor";
import type { Command } from "../../types";

const statut: Command = {
  data: new SlashCommandBuilder()
    .setName("statut")
    .setDescription("Affiche l'état des services Clover Games (site, Minecraft)")
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.reply({
      embeds: [buildStatusEmbed(interaction.client)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default statut;
