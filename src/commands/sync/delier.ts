import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { eq } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db";
import { botMinecraftLinks } from "../../db/schema";
import { usersMeta } from "../../db/site-schema";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { forgetLinkMirror } from "../../lib/mc-db";
import { syncMember } from "../../modules/sync/manager";
import type { Command } from "../../types";

const SETTINGS_URL = `${env.WEBSITE_URL.replace(/\/$/, "")}/profile/settings`;

/**
 * /delier — retire uniquement le lien fait par code sur Discord. Un lien fait sur le
 * site vit dans users_meta (table du site, jamais écrite par le bot) et se délie
 * depuis les paramètres du profil sur le site.
 */
const delier: Command = {
  data: new SlashCommandBuilder()
    .setName("delier")
    .setDescription("Retire la liaison Minecraft faite par code sur Discord")
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [codeLink] = await db
      .select()
      .from(botMinecraftLinks)
      .where(eq(botMinecraftLinks.discordId, interaction.user.id))
      .limit(1);
    const [siteRow] = await db
      .select()
      .from(usersMeta)
      .where(eq(usersMeta.discordId, interaction.user.id))
      .limit(1);
    const siteLinked = Boolean(siteRow?.minecraftUsername);

    if (!codeLink) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            siteLinked
              ? `Ton compte est lié via le **site** : délie-le depuis ${SETTINGS_URL}`
              : "Aucun compte Minecraft n'est lié à ton Discord.",
          ),
        ],
      });
      return;
    }

    await db
      .delete(botMinecraftLinks)
      .where(eq(botMinecraftLinks.discordId, interaction.user.id));
    // Seule la ligne du bot part : celle du site, si le compte a Discord en OAuth, décrit
    // une liaison toujours active — c'est exactement ce que la réponse ci-dessous annonce.
    await forgetLinkMirror(codeLink.minecraftUuid).catch((err) =>
      logger.warn({ err, userId: interaction.user.id }, "Miroir de liaison non mis à jour"),
    );
    await syncMember(interaction.member);

    await interaction.editReply({
      embeds: [
        successEmbed(
          siteLinked
            ? `Lien par code retiré. Ta liaison via le **site** reste active (gérable sur ${SETTINGS_URL}).`
            : `Compte **${codeLink.minecraftUsername}** délié de ton Discord.`,
        ),
      ],
    });
  },
};

export default delier;
