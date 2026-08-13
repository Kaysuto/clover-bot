import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { brandEmbed } from "../../lib/embeds";
import {
  SANCTION_LABELS,
  type SanctionType,
  getSanctions,
} from "../../modules/moderation/sanctions";
import type { Command } from "../../types";

const ICONS: Record<SanctionType, string> = {
  WARN: "⚠️",
  MUTE: "🔇",
  KICK: "👢",
  BAN: "🔨",
};

/** Discord plafonne une description d'embed à 4096 caractères. */
const MAX_ENTRIES = 15;

const casier: Command = {
  data: new SlashCommandBuilder()
    .setName("casier")
    .setDescription("Historique des sanctions d'un membre (staff)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre concerné").setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("membre", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rows = await getSanctions(interaction.guildId, target.id);
    const embed = brandEmbed()
      .setTitle(`📒 Casier de ${target.tag}`)
      .setThumbnail(target.displayAvatarURL({ size: 128 }));

    if (!rows.length) {
      embed.setDescription("Aucune sanction enregistrée. 🍀");
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const active = rows.filter((r) => r.active).length;
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.type] = (acc[row.type] ?? 0) + 1;
      return acc;
    }, {});

    const lines = rows.slice(0, MAX_ENTRIES).map((row) => {
      const type = row.type as SanctionType;
      const when = `<t:${Math.floor(row.createdAt.getTime() / 1_000)}:d>`;
      const state = row.active
        ? row.expiresAt
          ? `expire <t:${Math.floor(row.expiresAt.getTime() / 1_000)}:R>`
          : "en cours"
        : row.revokedAt
          ? "levée"
          : "close";
      return [
        `${ICONS[type]} **#${row.id}** · ${SANCTION_LABELS[type]} · ${when} · _${state}_`,
        `└ ${row.reason.slice(0, 180)} — par <@${row.moderatorId}>`,
      ].join("\n");
    });

    if (rows.length > MAX_ENTRIES) {
      lines.push(`_… et ${rows.length - MAX_ENTRIES} sanction(s) plus ancienne(s)._`);
    }

    embed
      .setDescription(lines.join("\n"))
      .addFields(
        { name: "Total", value: String(rows.length), inline: true },
        { name: "Actives", value: String(active), inline: true },
        {
          name: "Détail",
          value:
            Object.entries(counts)
              .map(([type, n]) => `${ICONS[type as SanctionType]} ${n}`)
              .join(" · ") || "—",
          inline: true,
        },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default casier;
