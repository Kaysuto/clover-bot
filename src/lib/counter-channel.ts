import type { Guild } from "discord.js";
import { logger } from "./logger";

/**
 * Renomme un salon compteur, uniquement si le nom a réellement changé.
 *
 * Discord limite les renommages à 2 par 10 minutes et par salon : chaque
 * appel inutile consomme ce quota et bloquerait la mise à jour suivante.
 */
export async function renameCounterChannel(
  guild: Guild,
  channelId: string,
  name: string,
  reason: string,
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const finalName = name.slice(0, 100);
  if (channel.name === finalName) return;

  await channel
    .setName(finalName, reason)
    .catch((err) =>
      logger.warn(
        { err, guildId: guild.id, channelId },
        "Renommage du salon compteur impossible",
      ),
    );
}
