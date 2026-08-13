import type { GuildMember, PartialGuildMember } from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { rconBroadcast } from "../../lib/rcon";
import { getLinkedAccount } from "../sync/manager";

export const DEFAULT_BOOST_MESSAGE =
  "💎 Merci {user} pour ton boost ! Le serveur compte maintenant **{count}** boost(s). 🍀";

/**
 * Remercie publiquement un nouveau booster et lui envoie sa récompense en jeu.
 * Appelé depuis `guildMemberUpdate`, à côté du log existant : le log constate,
 * ce module récompense.
 */
export async function handleBoost(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (oldMember.premiumSince || !newMember.premiumSince) return;

  const guild = newMember.guild;
  const cfg = await getGuildConfig(guild.id);

  if (cfg.boostChannelId) {
    const channel = await guild.channels.fetch(cfg.boostChannelId).catch(() => null);
    if (channel?.isSendable()) {
      const content = (cfg.boostMessage ?? DEFAULT_BOOST_MESSAGE)
        .replaceAll("{user}", `<@${newMember.id}>`)
        .replaceAll("{count}", String(guild.premiumSubscriptionCount ?? 0))
        .replaceAll("{server}", guild.name);

      await channel
        .send({
          content: `<@${newMember.id}>`,
          embeds: [
            brandEmbed()
              .setTitle("💎 Nouveau boost !")
              .setDescription(content)
              .setThumbnail(newMember.user.displayAvatarURL({ size: 128 }))
              .setTimestamp(),
          ],
        })
        .catch((err) =>
          logger.warn({ err, guildId: guild.id }, "Annonce de boost impossible"),
        );
    }
  }

  if (!cfg.boostRconCommand) return;

  const linked = await getLinkedAccount(newMember.id).catch(() => null);
  if (!linked) {
    await newMember
      .send({
        embeds: [
          brandEmbed().setDescription(
            "💎 Merci pour ton boost ! Une récompense t'attend en jeu : lie ton compte Minecraft avec `/lier` pour la recevoir.",
          ),
        ],
      })
      .catch(() => undefined);
    return;
  }

  const done = await rconBroadcast(
    cfg.boostRconCommand.replaceAll("{player}", linked.minecraftUsername),
  ).catch((err) => {
    logger.warn({ err, userId: newMember.id }, "Récompense de boost impossible");
    return [] as string[];
  });

  if (done.length) {
    logger.info(
      { userId: newMember.id, player: linked.minecraftUsername, servers: done },
      "Récompense de boost envoyée",
    );
    await newMember
      .send({
        embeds: [
          brandEmbed().setDescription(
            `💎 Merci pour ton boost ! Ta récompense a été envoyée à \`${linked.minecraftUsername}\` en jeu.`,
          ),
        ],
      })
      .catch(() => undefined);
  }
}
