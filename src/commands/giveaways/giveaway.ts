import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { botGiveaways } from "../../db/schema";
import { parseDuration } from "../../lib/duration";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import {
  buildGiveawayButtons,
  buildGiveawayEmbed,
  endGiveaway,
} from "../../modules/giveaways/manager";
import type { Command } from "../../types";

const MAX_DURATION_MS = 30 * 86_400_000; // 30 jours

const giveaway: Command = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Gérer les concours")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Lancer un concours")
        .addStringOption((o) =>
          o
            .setName("duree")
            .setDescription("Durée (ex. 30m, 2h, 1j, 1j12h)")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("prix").setDescription("Lot à gagner").setRequired(true).setMaxLength(200),
        )
        .addIntegerOption((o) =>
          o
            .setName("gagnants")
            .setDescription("Nombre de gagnants (défaut : 1)")
            .setMinValue(1)
            .setMaxValue(20),
        )
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon du concours (défaut : salon courant)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((o) =>
          o.setName("role_requis").setDescription("Rôle requis pour participer"),
        )
        .addIntegerOption((o) =>
          o
            .setName("niveau_min")
            .setDescription("Niveau minimum requis pour participer")
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("end")
        .setDescription("Terminer un concours immédiatement")
        .addStringOption((o) =>
          o.setName("id").setDescription("ID du message du concours").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("reroll")
        .setDescription("Retirer au sort de nouveaux gagnants")
        .addStringOption((o) =>
          o.setName("id").setDescription("ID du message du concours").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("nombre")
            .setDescription("Nombre de nouveaux gagnants (défaut : 1)")
            .setMinValue(1)
            .setMaxValue(20),
        ),
    )
    .addSubcommand((s) =>
      s.setName("list").setDescription("Liste des concours en cours"),
    ),
  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === "start") {
      const durationMs = parseDuration(interaction.options.getString("duree", true));
      if (!durationMs) {
        await interaction.reply({
          embeds: [errorEmbed("Durée invalide. Exemples : `30m`, `2h`, `1j`, `1j12h`.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (durationMs > MAX_DURATION_MS) {
        await interaction.reply({
          embeds: [errorEmbed("Durée maximale : 30 jours.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channelOption = interaction.options.getChannel("salon");
      const channel = channelOption
        ? await interaction.guild.channels.fetch(channelOption.id)
        : interaction.channel;
      if (!channel?.isSendable()) {
        await interaction.reply({
          embeds: [errorEmbed("Je ne peux pas écrire dans ce salon.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const [row] = await db
        .insert(botGiveaways)
        .values({
          guildId: interaction.guildId,
          channelId: channel.id,
          prize: interaction.options.getString("prix", true),
          winnersCount: interaction.options.getInteger("gagnants") ?? 1,
          hostId: interaction.user.id,
          requiredRoleId: interaction.options.getRole("role_requis")?.id ?? null,
          requiredMinLevel: interaction.options.getInteger("niveau_min"),
          endsAt: new Date(Date.now() + durationMs),
        })
        .returning();
      if (!row) return;

      const message = await channel.send({
        embeds: [buildGiveawayEmbed(row, 0)],
        components: [buildGiveawayButtons(row.id)],
      });
      await db
        .update(botGiveaways)
        .set({ messageId: message.id })
        .where(eq(botGiveaways.id, row.id));

      await interaction.reply({
        embeds: [successEmbed(`Concours lancé dans ${channel} ! 🎉`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "end" || sub === "reroll") {
      const messageId = interaction.options.getString("id", true).trim();
      const [row] = await db
        .select()
        .from(botGiveaways)
        .where(
          and(
            eq(botGiveaways.guildId, interaction.guildId),
            eq(botGiveaways.messageId, messageId),
          ),
        )
        .limit(1);

      if (!row) {
        await interaction.reply({
          embeds: [errorEmbed("Aucun concours trouvé avec cet ID de message.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "end") {
        if (row.ended) {
          await interaction.reply({
            embeds: [errorEmbed("Ce concours est déjà terminé.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const winners = await endGiveaway(client, row);
        await interaction.editReply({
          embeds: [
            successEmbed(
              winners.length
                ? `Concours terminé, ${winners.length} gagnant(s) tiré(s) au sort.`
                : "Concours terminé — aucun participant éligible.",
            ),
          ],
        });
        return;
      }

      // reroll
      if (!row.ended) {
        await interaction.reply({
          embeds: [errorEmbed("Ce concours n'est pas encore terminé.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const n = interaction.options.getInteger("nombre") ?? 1;
      const winners = await endGiveaway(
        client,
        { ...row, winnersCount: n },
        row.winnerIds, // exclut les gagnants précédents
      );
      await interaction.editReply({
        embeds: [
          successEmbed(
            winners.length
              ? `Nouveau tirage : ${winners.map((id) => `<@${id}>`).join(", ")}`
              : "Aucun participant éligible restant pour un nouveau tirage.",
          ),
        ],
      });
      return;
    }

    // list
    const active = await db
      .select()
      .from(botGiveaways)
      .where(
        and(
          eq(botGiveaways.guildId, interaction.guildId),
          eq(botGiveaways.ended, false),
        ),
      );

    const lines = active.map(
      (g) =>
        `· **${g.prize}** — <#${g.channelId}> — fin <t:${Math.floor(g.endsAt.getTime() / 1_000)}:R> — [message](https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId})`,
    );

    await interaction.reply({
      embeds: [
        brandEmbed()
          .setTitle("🎉 Concours en cours")
          .setDescription(lines.length ? lines.join("\n") : "*Aucun concours en cours.*"),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default giveaway;
