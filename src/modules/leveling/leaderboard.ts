import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  MessageFlags,
} from "discord.js";
import { count, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { botLevels } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import type { ComponentHandler } from "../../types";

const PAGE_SIZE = 10;

export async function buildLeaderboardPage(
  guild: Guild,
  page: number,
): Promise<{
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
  totalPages: number;
}> {
  const [total] = await db
    .select({ n: count() })
    .from(botLevels)
    .where(eq(botLevels.guildId, guild.id));
  const totalPages = Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const rows = await db
    .select()
    .from(botLevels)
    .where(eq(botLevels.guildId, guild.id))
    .orderBy(desc(botLevels.xp))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((row, i) => {
    const rank = (safePage - 1) * PAGE_SIZE + i + 1;
    const medal = safePage === 1 ? medals[rank - 1] : undefined;
    return `${medal ?? `**#${rank}**`} <@${row.userId}> — niveau **${row.level}** · ${row.xp.toLocaleString("fr-FR")} XP`;
  });

  const embed = brandEmbed()
    .setTitle("🏆 Classement des niveaux")
    .setDescription(lines.length ? lines.join("\n") : "*Personne n'a encore gagné d'XP.*")
    .setFooter({ text: `Page ${safePage}/${totalPages}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("lb", "page", safePage - 1))
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(buildId("lb", "page", safePage + 1))
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages),
  );

  return { embed, row, totalPages };
}

export const handleLeaderboardComponent: ComponentHandler = async (
  interaction,
  action,
  args,
) => {
  if (action !== "page" || !interaction.isButton()) return;
  const page = Number(args[0] ?? 1);
  if (!Number.isFinite(page)) {
    await interaction.deferUpdate();
    return;
  }
  const { embed, row } = await buildLeaderboardPage(interaction.guild, page);
  await interaction.update({ embeds: [embed], components: [row] });
};
