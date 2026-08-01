import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { eq } from "drizzle-orm";
import { linkDbConfigured } from "../../config";
import { db } from "../../db";
import { botMinecraftLinks } from "../../db/schema";
import { usersMeta } from "../../db/site-schema";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { consumeLinkCode, normalizeCode, peekLinkCode, recordLinkMirror } from "../../lib/mc-db";
import { logger } from "../../lib/logger";
import { syncMember } from "../../modules/sync/manager";
import type { Command } from "../../types";

/**
 * /lier code:ABCD-EFGH — consomme un code généré en jeu par /lier (module link du
 * plugin) et écrit le lien dans bot_minecraft_links. Les conflits sont vérifiés AVANT
 * la consommation pour ne jamais brûler un code sans créer de lien.
 */
const lier: Command = {
  data: new SlashCommandBuilder()
    .setName("lier")
    .setDescription("Lie ton compte Minecraft avec le code obtenu en jeu (/lier)")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("code")
        .setDescription("Code affiché en jeu (ex. ABCD-EFGH)")
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(20),
    ),
  async execute(interaction) {
    if (!linkDbConfigured) {
      await interaction.reply({
        embeds: [errorEmbed("La liaison par code n'est pas disponible pour le moment.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const code = normalizeCode(interaction.options.getString("code", true));
    const invalidMessage =
      "Code invalide, expiré ou déjà utilisé.\n👉 Connecte-toi en jeu et tape `/lier` pour en obtenir un.";
    if (code.length < 4) {
      await interaction.editReply({ embeds: [errorEmbed(invalidMessage)] });
      return;
    }

    let peek;
    try {
      peek = await peekLinkCode(code);
    } catch (err) {
      logger.error({ err }, "MySQL des codes de liaison injoignable");
      await interaction.editReply({
        embeds: [errorEmbed("Le serveur de liaison est momentanément injoignable, réessaie dans quelques minutes.")],
      });
      return;
    }
    if (!peek) {
      await interaction.editReply({ embeds: [errorEmbed(invalidMessage)] });
      return;
    }

    // Conflits avant consommation : le compte site prime toujours (users_meta,
    // jamais écrite par le bot), puis l'unicité de l'UUID côté liens par code.
    const [siteRow] = await db
      .select()
      .from(usersMeta)
      .where(eq(usersMeta.minecraftUuid, peek.playerUuid))
      .limit(1);
    if (siteRow?.discordId && siteRow.discordId !== interaction.user.id) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Ce compte Minecraft est déjà relié à un **autre compte Discord** via le site clovergames.fr.",
          ),
        ],
      });
      return;
    }
    const [uuidLink] = await db
      .select()
      .from(botMinecraftLinks)
      .where(eq(botMinecraftLinks.minecraftUuid, peek.playerUuid))
      .limit(1);
    if (uuidLink && uuidLink.discordId !== interaction.user.id) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Ce compte Minecraft est déjà lié à un autre compte Discord.\nLe propriétaire doit d'abord utiliser `/delier`.",
          ),
        ],
      });
      return;
    }

    const consumed = await consumeLinkCode(code, interaction.user.id, interaction.user.username);
    if (!consumed) {
      await interaction.editReply({ embeds: [errorEmbed(invalidMessage)] });
      return;
    }

    try {
      await db
        .insert(botMinecraftLinks)
        .values({
          discordId: interaction.user.id,
          minecraftUuid: consumed.playerUuid,
          minecraftUsername: consumed.playerName,
          source: "CODE",
        })
        .onConflictDoUpdate({
          target: botMinecraftLinks.discordId,
          set: {
            minecraftUuid: consumed.playerUuid,
            minecraftUsername: consumed.playerName,
            source: "CODE",
            linkedAt: new Date(),
          },
        });
    } catch (err) {
      // Course sur l'unicité de minecraft_uuid : un autre Discord a lié cet UUID entre-temps.
      logger.warn({ err, userId: interaction.user.id }, "Écriture du lien impossible");
      await interaction.editReply({
        embeds: [errorEmbed("Ce compte Minecraft vient d'être lié par quelqu'un d'autre.")],
      });
      return;
    }

    // Miroir consultatif du plugin : /lier en jeu ne reproposera plus Discord. Le lien
    // Discord est déjà écrit, un échec ici ne doit donc pas être remonté au joueur.
    await recordLinkMirror(consumed.playerUuid, interaction.user.id, interaction.user.username)
      .catch((err) => logger.warn({ err, userId: interaction.user.id }, "Miroir de liaison non mis à jour"));

    const result = await syncMember(interaction.member);
    const suffix =
      result.status === "partial"
        ? "\n⚠️ Le pseudo n'a pas pu être appliqué (propriétaire du serveur ou rôle au-dessus du bot)."
        : "";
    await interaction.editReply({
      embeds: [
        successEmbed(
          `Compte Minecraft **${consumed.playerName}** lié à ton Discord !${suffix}`,
        ),
      ],
    });
  },
};

export default lier;
