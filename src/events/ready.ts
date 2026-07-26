import { logger } from "../lib/logger";
import { registerJob } from "../lib/scheduler";
import { tickGiveaways } from "../modules/giveaways/manager";
import { syncGuildInvites } from "../modules/invites/cache";
import { tickVoiceXp } from "../modules/leveling/voice-xp";
import { tickMcCounter } from "../modules/mc-counter/job";
import { tickMemberCounter } from "../modules/member-counter/job";
import { tickStatus } from "../modules/status/monitor";
import { syncGuild } from "../modules/sync/manager";
import { cleanupTempVoice } from "../modules/tempvoice/manager";
import { reconcileTickets } from "../modules/tickets/manager";
import type { EventHandler } from "../types";

const ready: EventHandler<"clientReady"> = {
  name: "clientReady",
  once: true,
  async execute(client) {
    logger.info(`✅ Connecté en tant que ${client.user?.tag}`);

    // Remise en cohérence après redémarrage
    for (const guild of client.guilds.cache.values()) {
      await syncGuildInvites(guild).catch((err) =>
        logger.error({ err, guildId: guild.id }, "Sync des invitations impossible"),
      );
    }
    await cleanupTempVoice(client).catch((err) =>
      logger.error({ err }, "Nettoyage des vocaux temporaires impossible"),
    );
    await reconcileTickets(client).catch((err) =>
      logger.error({ err }, "Réconciliation des tickets impossible"),
    );

    // Jobs périodiques — tous relisent la DB, donc reprise automatique
    // après redémarrage (aucun timer long en mémoire).
    registerJob({
      name: "giveaways",
      intervalMs: 20_000,
      run: () => tickGiveaways(client),
    });
    registerJob({
      name: "voice-xp",
      intervalMs: 60_000,
      run: () => tickVoiceXp(client),
    });
    registerJob({
      name: "status",
      intervalMs: 60_000,
      run: () => tickStatus(client),
      runOnStart: true,
    });
    registerJob({
      name: "mc-counter",
      intervalMs: 6 * 60_000, // limite Discord : 2 renommages / 10 min / salon
      run: () => tickMcCounter(client),
      runOnStart: true,
    });
    registerJob({
      name: "member-counter",
      intervalMs: 6 * 60_000, // même limite de renommage que le compteur joueurs
      run: () => tickMemberCounter(client),
      runOnStart: true,
    });
    registerJob({
      name: "sync-minecraft",
      intervalMs: 6 * 3_600_000,
      run: async () => {
        for (const guild of client.guilds.cache.values()) {
          await syncGuild(guild);
        }
      },
      runOnStart: true,
    });
    registerJob({
      name: "invites-refresh",
      intervalMs: 3_600_000,
      run: async () => {
        for (const guild of client.guilds.cache.values()) {
          await syncGuildInvites(guild);
        }
      },
    });

    logger.info("🍀 Clover Bot prêt !");
  },
};

export default ready;
