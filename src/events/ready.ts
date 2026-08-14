import { syncGuildCommands } from "../lib/command-sync";
import { touchHeartbeat } from "../lib/heartbeat";
import { logger } from "../lib/logger";
import { registerJob } from "../lib/scheduler";
import { seedServers } from "../lib/servers";
import { refreshApplicationPanels } from "../modules/applications/manager";
import { tickGiveaways } from "../modules/giveaways/manager";
import { syncGuildInvites } from "../modules/invites/cache";
import { tickInviteRewards } from "../modules/invites/rewards";
import { tickVoiceXp } from "../modules/leveling/voice-xp";
import { pruneXpCooldowns } from "../modules/leveling/xp";
import { tickMcCounter } from "../modules/mc-counter/job";
import { tickMemberCounter } from "../modules/member-counter/job";
import { tickSanctions } from "../modules/moderation/sanctions";
import { tickRankSync } from "../modules/ranks/sync";
import { tickStatus } from "../modules/status/monitor";
import { tickSiteLinksDelta } from "../modules/sync/delta";
import { syncGuild } from "../modules/sync/manager";
import { cleanupTempVoice } from "../modules/tempvoice/manager";
import { reconcileTickets, refreshTicketPanels } from "../modules/tickets/manager";
import { tickVoteRoles } from "../modules/vote/manager";
import { startVoteServer } from "../modules/vote/server";
import type { EventHandler } from "../types";

const ready: EventHandler<"clientReady"> = {
  name: "clientReady",
  once: true,
  async execute(client) {
    logger.info(`✅ Connecté en tant que ${client.user?.tag}`);

    // Registre des serveurs du réseau : semé une fois, modifiable par /reseau.
    await seedServers().catch((err) =>
      logger.error({ err }, "Enregistrement des serveurs du réseau impossible"),
    );

    // Une commande ajoutée au code doit exister sur Discord sans étape manuelle.
    await syncGuildCommands(client).catch((err) =>
      logger.error({ err }, "Publication des slash commands impossible"),
    );

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
    await refreshTicketPanels(client).catch((err) =>
      logger.error({ err }, "Actualisation des panneaux de tickets impossible"),
    );
    await refreshApplicationPanels(client).catch((err) =>
      logger.error({ err }, "Actualisation des panneaux de candidatures impossible"),
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
      name: "ranks-sync",
      intervalMs: 6 * 3_600_000, // grades LuckPerms → rôles Discord
      run: () => tickRankSync(client),
      runOnStart: true,
    });
    registerJob({
      name: "site-links-delta",
      intervalMs: 60_000, // liaison faite sur le site → rôle/pseudo Discord en ~1 min
      run: () => tickSiteLinksDelta(client),
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
    registerJob({
      name: "invite-rewards",
      intervalMs: 30 * 60_000, // maturation des parrainages (J+7 par défaut)
      run: () => tickInviteRewards(client),
      runOnStart: true,
    });
    registerJob({
      name: "vote-roles",
      intervalMs: 5 * 60_000, // retrait des rôles « votant » échus
      run: () => tickVoteRoles(client),
    });
    registerJob({
      name: "sanctions-expiry",
      intervalMs: 60_000, // relit la base : les échéances passées hors ligne sont rattrapées
      run: () => tickSanctions(client),
      runOnStart: true,
    });
    registerJob({
      name: "heartbeat",
      intervalMs: 30_000,
      run: async () => {
        if (client.isReady()) await touchHeartbeat();
      },
      runOnStart: true,
    });
    registerJob({
      name: "xp-cooldowns",
      intervalMs: 3_600_000, // purge des cooldowns XP expirés (table en mémoire)
      run: async () => {
        const removed = pruneXpCooldowns();
        if (removed) logger.debug({ removed }, "Cooldowns XP purgés");
      },
    });

    // Réception des votes : n'ouvre un port que si VOTE_HTTP_PORT et VOTE_TOKEN
    // sont renseignés (cf. modules/vote/server.ts).
    startVoteServer(client);

    logger.info("🍀 Clover Bot prêt !");
  },
};

export default ready;
