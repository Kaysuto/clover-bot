import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";

const ping: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifie que le bot répond")
    .setContexts(InteractionContextType.Guild),
  async execute(interaction, client) {
    await interaction.reply({
      content: `🏓 Pong ! Latence WebSocket : **${Math.round(client.ws.ping)} ms**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default ping;
