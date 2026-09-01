import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { sendLog } from "../../modules/logs/channel";
import { LOG_COLOR, logEmbed, userLine } from "../../modules/logs/format";
import type { Command } from "../../types";

/** Plafond de l'API : une suppression groupée porte sur 100 messages au plus. */
const MAX_MESSAGES = 100;
/** Discord refuse la suppression groupée au-delà de 14 jours. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

const clear: Command = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprime les derniers messages du salon (staff)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o
        .setName("nombre")
        .setDescription("Nombre de messages à supprimer (1 à 100)")
        .setMinValue(1)
        .setMaxValue(MAX_MESSAGES)
        .setRequired(true),
    )
    .addUserOption((o) =>
      o
        .setName("membre")
        .setDescription("Ne supprimer que les messages de ce membre"),
    ),

  async execute(interaction) {
    const count = interaction.options.getInteger("nombre", true);
    const target = interaction.options.getUser("membre");
    const channel = interaction.channel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!channel) {
      await interaction.editReply({
        embeds: [errorEmbed("Salon introuvable.")],
      });
      return;
    }

    if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Il me manque la permission **Gérer les messages** dans ce salon.",
          ),
        ],
      });
      return;
    }

    // Avec un filtre par membre, les `nombre` messages recherchés peuvent être
    // dispersés : on ratisse le maximum autorisé puis on coupe après filtrage.
    const fetched = await channel.messages.fetch({
      limit: target ? MAX_MESSAGES : count,
    });
    const now = Date.now();
    const doomed = fetched
      .filter(
        (message) =>
          !message.pinned &&
          now - message.createdTimestamp < MAX_AGE_MS &&
          (!target || message.author.id === target.id),
      )
      .first(count);

    if (!doomed.length) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Aucun message supprimable : ils sont épinglés, plus vieux que 14 jours, ou d'un autre auteur.",
          ),
        ],
      });
      return;
    }

    await channel.bulkDelete(doomed, false);

    const scope = target ? ` de ${target}` : "";
    const missing =
      doomed.length < count
        ? "\n_Les messages épinglés et ceux de plus de 14 jours ont été ignorés._"
        : "";
    await interaction.editReply({
      embeds: [
        successEmbed(
          `**${doomed.length}** message(s)${scope} supprimé(s).${missing}`,
        ),
      ],
    });

    await sendLog(
      interaction.guild,
      "moderation",
      logEmbed(LOG_COLOR.remove, "🧹 Messages supprimés")
        .setDescription(
          `${userLine(interaction.user)} a supprimé **${doomed.length}** message(s) dans ${channel}.`,
        )
        .addFields(
          { name: "Demandé", value: String(count), inline: true },
          {
            name: "Filtre",
            value: target ? `<@${target.id}>` : "—",
            inline: true,
          },
        ),
    ).catch(() => undefined);
  },
};

export default clear;
