import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { botLevels } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { totalXpForLevel, xpForLevel } from "../../modules/leveling/formula";
import type { Command } from "../../types";

function progressBar(current: number, needed: number, size = 12): string {
  const filled = Math.min(size, Math.round((current / needed) * size));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

const rank: Command = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Affiche ton niveau (ou celui d'un membre)")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre à consulter").setRequired(false),
    ),
  async execute(interaction) {
    const target = interaction.options.getMember("membre") ?? interaction.member;

    const [row] = await db
      .select()
      .from(botLevels)
      .where(
        and(
          eq(botLevels.guildId, interaction.guildId),
          eq(botLevels.userId, target.id),
        ),
      )
      .limit(1);

    if (!row) {
      await interaction.reply({
        content:
          target.id === interaction.user.id
            ? "Tu n'as pas encore gagné d'XP. Participe aux discussions ! 💬"
            : `${target.displayName} n'a pas encore gagné d'XP.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [better] = await db
      .select({ n: count() })
      .from(botLevels)
      .where(
        and(eq(botLevels.guildId, interaction.guildId), gt(botLevels.xp, row.xp)),
      );
    const position = (better?.n ?? 0) + 1;

    const inLevel = row.xp - totalXpForLevel(row.level);
    const needed = xpForLevel(row.level);

    const embed = brandEmbed()
      .setAuthor({
        name: target.displayName,
        iconURL: target.displayAvatarURL(),
      })
      .addFields(
        { name: "Niveau", value: `**${row.level}**`, inline: true },
        { name: "Rang", value: `#${position}`, inline: true },
        {
          name: "XP total",
          value: row.xp.toLocaleString("fr-FR"),
          inline: true,
        },
        {
          name: `Progression vers le niveau ${row.level + 1}`,
          value: `${progressBar(inLevel, needed)} ${inLevel.toLocaleString("fr-FR")} / ${needed.toLocaleString("fr-FR")} XP`,
        },
        { name: "Messages", value: String(row.messageCount), inline: true },
        {
          name: "Minutes en vocal",
          value: String(row.voiceMinutes),
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default rank;
