import { eq } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botServerCounters } from "../../db/schema";
import { renameCounterChannel } from "../../lib/counter-channel";
import { getMcStatus, getServerStatus } from "../../lib/mc-status";
import { getServer } from "../../lib/servers";

/**
 * Job (6 min — Discord limite les renommages à 2 par 10 min et par salon) :
 * met à jour le salon compteur global (tout le réseau) puis les compteurs
 * dédiés à un serveur (`bot_server_counters`).
 */
export async function tickMcCounter(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);

    if (cfg.counterChannelId) {
      const status = await getMcStatus();
      const name = status.online
        ? cfg.counterTemplate
            .replaceAll("{count}", String(status.players))
            .replaceAll("{max}", String(status.maxPlayers))
        : "🔴 Serveur hors ligne";
      await renameCounterChannel(guild, cfg.counterChannelId, name);
    }

    const counters = await db
      .select()
      .from(botServerCounters)
      .where(eq(botServerCounters.guildId, guild.id));

    for (const counter of counters) {
      const server = await getServer(counter.serverKey);
      if (!server) continue; // serveur désactivé ou supprimé du registre

      const status = await getServerStatus(server);
      const name = status.online
        ? counter.template
            .replaceAll("{count}", String(status.players))
            .replaceAll("{max}", String(status.maxPlayers))
            .replaceAll("{label}", server.label)
            .replaceAll("{emoji}", server.emoji)
        : `🔴 ${server.label} hors ligne`;
      await renameCounterChannel(guild, counter.channelId, name);
    }
  }
}
