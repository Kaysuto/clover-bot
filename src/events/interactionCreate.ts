import { MessageFlags } from "discord.js";
import { errorEmbed } from "../lib/embeds";
import { parseId } from "../lib/ids";
import { logger } from "../lib/logger";
import type { EventHandler } from "../types";

const interactionCreate: EventHandler<"interactionCreate"> = {
  name: "interactionCreate",
  async execute(client, interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (!interaction.inCachedGuild()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) {
          logger.warn({ command: interaction.commandName }, "Commande inconnue");
          return;
        }
        await command.execute(interaction, client);
        return;
      }

      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const { prefix, action, args } = parseId(interaction.customId);
        // Sondage de départ : le membre a quitté la guilde, l'interaction
        // arrive donc en MP et n'a ni guilde ni membre à résoudre.
        if (!interaction.inGuild()) {
          const dmHandler = client.dmComponents.get(prefix);
          if (dmHandler) await dmHandler(interaction, action, args, client);
          return;
        }
        if (!interaction.inCachedGuild()) return;
        const handler = client.components.get(prefix);
        if (handler) await handler(interaction, action, args, client);
        return;
      }
    } catch (err) {
      logger.error(
        { err, type: interaction.type },
        "Erreur lors du traitement d'une interaction",
      );
      if (!interaction.isRepliable()) return;
      const payload = {
        embeds: [errorEmbed("Une erreur est survenue. Réessaie dans un instant.")],
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  },
};

export default interactionCreate;
