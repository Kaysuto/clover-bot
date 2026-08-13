import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type GuildTextBasedChannel,
  MessageFlags,
} from "discord.js";
import { and, count, eq, lte } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { botGiveawayEntries, botGiveaways, botLevels } from "../../db/schema";
import { brandEmbed, errorEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import type { ComponentHandler } from "../../types";

export type GiveawayRow = typeof botGiveaways.$inferSelect;

function sample<T>(items: T[], n: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (pool.length && picked.length < n) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]!);
  }
  return picked;
}

function timestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:R>`;
}

export function buildGiveawayEmbed(
  row: GiveawayRow,
  entryCount: number,
): EmbedBuilder {
  const conditions: string[] = [];
  if (row.requiredRoleId) conditions.push(`Rôle requis : <@&${row.requiredRoleId}>`);
  if (row.requiredMinLevel)
    conditions.push(`Niveau minimum : **${row.requiredMinLevel}**`);

  const embed = brandEmbed()
    .setTitle(`🎉 ${row.prize}`)
    .setFooter({ text: `${entryCount} participation(s)` })
    .setTimestamp(row.endsAt);

  if (row.ended) {
    embed.setDescription(
      [
        "🎊 **Concours terminé !**",
        row.winnerIds.length
          ? `Gagnant(s) : ${row.winnerIds.map((id) => `<@${id}>`).join(", ")}`
          : "Aucun participant éligible… 😢",
        `Organisé par <@${row.hostId}>`,
      ].join("\n"),
    );
  } else {
    embed.setDescription(
      [
        "Clique sur 🎉 pour participer (reclique pour te retirer) !",
        `Fin ${timestamp(row.endsAt)} · **${row.winnersCount}** gagnant(s)`,
        `Organisé par <@${row.hostId}>`,
        ...(conditions.length ? ["", "**Conditions :**", ...conditions.map((c) => `· ${c}`)] : []),
      ].join("\n"),
    );
  }
  return embed;
}

export function buildGiveawayButtons(
  giveawayId: number,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("giveaway", "enter", giveawayId))
      .setEmoji("🎉")
      .setLabel("Participer")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

async function entryCount(giveawayId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(botGiveawayEntries)
    .where(eq(botGiveawayEntries.giveawayId, giveawayId));
  return row?.n ?? 0;
}

/** Bouton 🎉 : participation en toggle, avec vérification des conditions. */
export const handleGiveawayComponent: ComponentHandler = async (
  interaction,
  action,
  args,
) => {
  if (action !== "enter" || !interaction.isButton()) return;
  const giveawayId = Number(args[0]);

  const [row] = await db
    .select()
    .from(botGiveaways)
    .where(eq(botGiveaways.id, giveawayId))
    .limit(1);

  if (!row || row.ended) {
    await interaction.reply({
      embeds: [errorEmbed("Ce concours est terminé.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Conditions
  if (row.requiredRoleId && !interaction.member.roles.cache.has(row.requiredRoleId)) {
    await interaction.reply({
      embeds: [
        errorEmbed(`Il te faut le rôle <@&${row.requiredRoleId}> pour participer.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (row.requiredMinLevel) {
    const [levelRow] = await db
      .select()
      .from(botLevels)
      .where(
        and(
          eq(botLevels.guildId, interaction.guildId),
          eq(botLevels.userId, interaction.user.id),
        ),
      )
      .limit(1);
    if ((levelRow?.level ?? 0) < row.requiredMinLevel) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `Il te faut être **niveau ${row.requiredMinLevel}** pour participer (tu es niveau ${levelRow?.level ?? 0}).`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  // Toggle : insertion, ou retrait si déjà inscrit
  const inserted = await db
    .insert(botGiveawayEntries)
    .values({ giveawayId, userId: interaction.user.id })
    .onConflictDoNothing()
    .returning();

  let message: string;
  if (inserted.length) {
    message = "🎉 Participation enregistrée, bonne chance !";
  } else {
    await db
      .delete(botGiveawayEntries)
      .where(
        and(
          eq(botGiveawayEntries.giveawayId, giveawayId),
          eq(botGiveawayEntries.userId, interaction.user.id),
        ),
      );
    message = "↩️ Participation retirée.";
  }

  await interaction.reply({
    embeds: [brandEmbed().setDescription(message)],
    flags: MessageFlags.Ephemeral,
  });

  // Met à jour le compteur affiché dans le footer
  const n = await entryCount(giveawayId);
  await interaction.message
    .edit({ embeds: [buildGiveawayEmbed(row, n)] })
    .catch(() => undefined);
};

/**
 * Marque le concours comme terminé, en un seul UPDATE conditionnel : c'est le
 * verrou qui empêche `/giveaway end` et le job de clôturer le même concours en
 * parallèle (le tirage dure le temps de résoudre tous les membres). Renvoie
 * `false` si quelqu'un d'autre a déjà pris la main.
 */
export async function claimGiveaway(giveawayId: number): Promise<boolean> {
  const claimed = await db
    .update(botGiveaways)
    .set({ ended: true })
    .where(and(eq(botGiveaways.id, giveawayId), eq(botGiveaways.ended, false)))
    .returning({ id: botGiveaways.id });
  return claimed.length > 0;
}

/**
 * Job (20 s) : termine les concours arrivés à échéance. Aucun timer long en
 * mémoire → après un redémarrage, les concours échus pendant l'arrêt sont
 * tirés au premier tick.
 */
export async function tickGiveaways(client: CloverClient): Promise<void> {
  const due = await db
    .select()
    .from(botGiveaways)
    .where(and(eq(botGiveaways.ended, false), lte(botGiveaways.endsAt, new Date())));

  for (const row of due) {
    if (!(await claimGiveaway(row.id))) continue;
    await endGiveaway(client, row).catch((err) =>
      logger.error({ err, giveaway: row.id }, "Fin de concours impossible"),
    );
  }
}

/** Tire les gagnants (en revalidant les conditions) et clôt le concours. */
export async function endGiveaway(
  client: CloverClient,
  row: GiveawayRow,
  excludeIds: string[] = [],
): Promise<string[]> {
  const guild = client.guilds.cache.get(row.guildId);

  const entries = await db
    .select()
    .from(botGiveawayEntries)
    .where(eq(botGiveawayEntries.giveawayId, row.id));

  const eligible: string[] = [];
  for (const entry of entries) {
    if (excludeIds.includes(entry.userId)) continue;
    const member = guild
      ? await guild.members.fetch(entry.userId).catch(() => null)
      : null;
    if (!member) continue; // parti du serveur
    if (row.requiredRoleId && !member.roles.cache.has(row.requiredRoleId)) continue;
    if (row.requiredMinLevel) {
      const [levelRow] = await db
        .select()
        .from(botLevels)
        .where(
          and(eq(botLevels.guildId, row.guildId), eq(botLevels.userId, entry.userId)),
        )
        .limit(1);
      if ((levelRow?.level ?? 0) < row.requiredMinLevel) continue;
    }
    eligible.push(entry.userId);
  }

  const winners = sample(eligible, row.winnersCount);

  const [updated] = await db
    .update(botGiveaways)
    .set({ ended: true, winnerIds: winners })
    .where(eq(botGiveaways.id, row.id))
    .returning();
  const finalRow = updated ?? { ...row, ended: true, winnerIds: winners };

  // Édition du message + annonce
  const channel = guild
    ? ((await guild.channels.fetch(row.channelId).catch(() => null)) as
        | GuildTextBasedChannel
        | null)
    : null;

  if (channel && row.messageId) {
    const message = await channel.messages
      .fetch(row.messageId)
      .catch(() => null);
    if (message) {
      const n = await entryCount(row.id);
      await message
        .edit({
          embeds: [buildGiveawayEmbed(finalRow, n)],
          components: [buildGiveawayButtons(row.id, true)],
        })
        .catch(() => undefined);
    }
    if (channel.isSendable()) {
      const content = winners.length
        ? `🎊 Félicitations ${winners.map((id) => `<@${id}>`).join(", ")} ! Vous remportez **${row.prize}** !`
        : `😢 Aucun gagnant pour **${row.prize}** (aucun participant éligible).`;
      await channel
        .send({
          content,
          reply: row.messageId
            ? { messageReference: row.messageId, failIfNotExists: false }
            : undefined,
        })
        .catch(() => undefined);
    }
  }

  return winners;
}
