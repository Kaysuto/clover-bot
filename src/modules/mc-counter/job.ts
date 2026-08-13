import type { CloverClient } from "../../client";
import { getGuildConfig } from "../../db/guild-config";
import { renameCounterChannel } from "../../lib/counter-channel";
import { getMcStatus } from "../../lib/mc-status";

/**
 * Job (6 min — Discord limite les renommages à 2 par 10 min et par salon) :
 * met à jour le nom du salon vocal compteur avec le nombre de joueurs.
 */
export async function tickMcCounter(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.counterChannelId) continue;

    const status = await getMcStatus();
    const name = status.online
      ? cfg.counterTemplate
          .replaceAll("{count}", String(status.players))
          .replaceAll("{max}", String(status.maxPlayers))
      : "🔴 Serveur hors ligne";

    await renameCounterChannel(guild, cfg.counterChannelId, name);
  }
}
