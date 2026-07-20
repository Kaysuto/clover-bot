import type { CloverClient } from "../../client";
import { getGuildConfig } from "../../db/guild-config";
import { logger } from "../../lib/logger";
import { getMcStatus } from "../../lib/mc-status";

/**
 * Job (6 min — Discord limite les renommages de salon à 2 par 10 min) :
 * met à jour le nom du salon vocal compteur avec le nombre de joueurs.
 */
export async function tickMcCounter(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.counterChannelId) continue;

    const channel = await guild.channels
      .fetch(cfg.counterChannelId)
      .catch(() => null);
    if (!channel) continue;

    const status = await getMcStatus();
    const name = (
      status.online
        ? cfg.counterTemplate
            .replaceAll("{count}", String(status.players))
            .replaceAll("{max}", String(status.maxPlayers))
        : "🔴 Serveur hors ligne"
    ).slice(0, 100);

    // Ne renommer que si nécessaire : chaque rename consomme le rate limit.
    if (channel.name === name) continue;
    await channel
      .setName(name, "Compteur de joueurs Minecraft")
      .catch((err) =>
        logger.warn({ err, guildId: guild.id }, "Renommage du compteur impossible"),
      );
  }
}
