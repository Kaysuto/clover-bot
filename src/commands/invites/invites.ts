import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botInviteStats } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { inviteRewardSummary } from "../../modules/invites/rewards";
import type { Command } from "../../types";

const totalExpr = sql<number>`${botInviteStats.seedUses} + ${botInviteStats.joins} - ${botInviteStats.leaves} + ${botInviteStats.bonus}`;

const invites: Command = {
  data: new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Suivi des invitations")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName("voir")
        .setDescription("Affiche tes invitations (ou celles d'un membre)")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre à consulter"),
        ),
    )
    .addSubcommand((s) =>
      s.setName("classement").setDescription("Top des inviteurs du serveur"),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "voir") {
      const target =
        interaction.options.getUser("membre") ?? interaction.user;
      const [row] = await db
        .select()
        .from(botInviteStats)
        .where(
          and(
            eq(botInviteStats.guildId, interaction.guildId),
            eq(botInviteStats.userId, target.id),
          ),
        )
        .limit(1);

      const total = row
        ? row.seedUses + row.joins - row.leaves + row.bonus
        : 0;

      const embed = brandEmbed()
        .setAuthor({
          name: target.displayName ?? target.username,
          iconURL: target.displayAvatarURL(),
        })
        .setDescription(`🔗 **${total}** invitation(s)`)
        .addFields(
          {
            name: "Arrivées",
            value: String(row?.joins ?? 0),
            inline: true,
          },
          { name: "Départs", value: String(row?.leaves ?? 0), inline: true },
          {
            name: "Historiques",
            value: String(row?.seedUses ?? 0),
            inline: true,
          },
          { name: "Bonus", value: String(row?.bonus ?? 0), inline: true },
        )
        .setFooter({
          text: "Historiques = invitations comptées avant l'installation du bot",
        });

      // Récompenses : n'apparaît que si le parrainage rapporte quelque chose.
      const cfg = await getGuildConfig(interaction.guildId);
      if (cfg.inviteXp > 0 || cfg.inviteCredits > 0) {
        const summary = await inviteRewardSummary(interaction.guildId, target.id);
        embed.addFields({
          name: "Récompenses",
          value: [
            `⏳ ${summary.pending} en attente _(maturation : ${cfg.inviteMaturityDays} j)_`,
            `✅ ${summary.rewarded} validée(s)`,
            `❌ ${summary.rejected} refusée(s)`,
            summary.credits ? `🪙 ${summary.credits} crédits versés` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // classement
    const rows = await db
      .select({
        userId: botInviteStats.userId,
        total: totalExpr,
      })
      .from(botInviteStats)
      .where(eq(botInviteStats.guildId, interaction.guildId))
      .orderBy(sql`${totalExpr} DESC`)
      .limit(10);

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows
      .filter((r) => Number(r.total) > 0)
      .map(
        (r, i) =>
          `${medals[i] ?? `**#${i + 1}**`} <@${r.userId}> — **${r.total}** invitation(s)`,
      );

    await interaction.reply({
      embeds: [
        brandEmbed()
          .setTitle("🔗 Classement des invitations")
          .setDescription(
            lines.length ? lines.join("\n") : "*Aucune invitation comptée.*",
          ),
      ],
    });
  },
};

export default invites;
