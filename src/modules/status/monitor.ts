import { type Client, type EmbedBuilder, WebhookClient } from "discord.js";
import type { CloverClient } from "../../client";
import { env } from "../../config";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { BRAND_COLOR, ERROR_COLOR, WARN_COLOR, brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { getMcStatus, getServerStatus } from "../../lib/mc-status";
import { rconHealthCheck } from "../../lib/rcon";
import { getServers, serverAddress } from "../../lib/servers";

type Health = "up" | "down" | "unknown";

interface ServiceState {
  /** Libellé affiché en titre de colonne. */
  label: string;
  consecutiveFails: number;
  effective: Health;
  /** État court affiché en gras : « En ligne », « Injoignable »… */
  detail: string;
  /** Ligne secondaire facultative : joueurs connectés, adresse… */
  extra?: string;
}

/** Adresse du site sans le protocole, pour un affichage compact. */
const WEBSITE_HOST = (() => {
  try {
    return new URL(env.WEBSITE_URL).host;
  } catch {
    return env.WEBSITE_URL;
  }
})();

/** Anti-flap : 2 échecs consécutifs avant de déclarer un service hors ligne. */
const FAIL_THRESHOLD = 2;

/**
 * États indexés par clé de service : `website`, puis un `mc:<clé>` par serveur
 * du réseau. La table se remplit toute seule au premier tick — un serveur
 * ajouté par `/config serveurs` apparaît sans redémarrage.
 */
const states = new Map<string, ServiceState>();

/** Dernier état RCON connu par serveur (rafraîchi toutes les 5 min). */
const rconDetails = new Map<string, string | null>();

let tickCount = 0;

const webhook = env.DISCORD_MONITORING_WEBHOOK_URL
  ? new WebhookClient({ url: env.DISCORD_MONITORING_WEBHOOK_URL })
  : null;

async function checkWebsite(): Promise<boolean> {
  try {
    const res = await fetch(env.WEBSITE_URL, {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

function updateState(
  key: string,
  label: string,
  ok: boolean,
  detail: string,
  extra?: string,
): void {
  const state = states.get(key) ?? {
    label,
    consecutiveFails: 0,
    effective: "unknown" as Health,
    detail: "",
  };
  const previous = state.effective;

  state.label = label;
  if (ok) {
    state.consecutiveFails = 0;
    state.effective = "up";
  } else {
    state.consecutiveFails++;
    if (state.consecutiveFails >= FAIL_THRESHOLD) state.effective = "down";
  }
  state.detail = detail;
  state.extra = extra;
  states.set(key, state);

  if (previous === "up" && state.effective === "down") void alertDown(state.label);
  if (previous === "down" && state.effective === "up") void alertUp(state.label);
}

async function alertDown(label: string): Promise<void> {
  logger.warn({ service: label }, "Service passé HORS LIGNE");
  await sendAlert(
    ERROR_COLOR,
    "🚨 Alerte service",
    `**${label}** vient de passer **hors ligne**.`,
  );
}

async function alertUp(label: string): Promise<void> {
  logger.info({ service: label }, "Service rétabli");
  await sendAlert(
    BRAND_COLOR,
    "✅ Service rétabli",
    `**${label}** répond de nouveau.`,
  );
}

async function sendAlert(
  color: number,
  title: string,
  description: string,
): Promise<void> {
  if (!webhook) return;
  await webhook
    .send({
      embeds: [
        brandEmbed().setColor(color).setTitle(title).setDescription(description).setTimestamp(),
      ],
    })
    .catch((err) => logger.warn({ err }, "Envoi de l'alerte webhook impossible"));
}

function statusIcon(state: ServiceState): string {
  if (state.effective === "up") return "🟢";
  if (state.effective === "down") return "🔴";
  return "🟡";
}

/** Bandeau de synthèse : une phrase + la couleur de l'embed. */
function summarize(): { line: string; color: number } {
  const monitored = [...states.values()];
  if (!monitored.length) {
    return { line: "🟡 **Vérification en cours…**", color: WARN_COLOR };
  }

  const down = monitored.filter((s) => s.effective === "down");
  if (down.length) {
    return {
      line:
        down.length === 1
          ? `🔴 **Incident en cours** — ${down[0]!.label} est indisponible`
          : `🔴 **Incident en cours** — ${down.length} services sont indisponibles`,
      color: ERROR_COLOR,
    };
  }
  if (monitored.some((s) => s.effective === "unknown")) {
    return { line: "🟡 **Vérification en cours…**", color: WARN_COLOR };
  }
  return {
    line: "✅ **Tous les services sont opérationnels**",
    color: BRAND_COLOR,
  };
}

/** Une colonne du tableau de bord (3 par ligne grâce à `inline`). */
function serviceField(state: ServiceState) {
  const value = [`${statusIcon(state)} **${state.detail || "Vérification…"}**`, state.extra]
    .filter(Boolean)
    .join("\n");
  return { name: state.label, value, inline: true };
}

export function buildStatusEmbed(client: Client): EmbedBuilder {
  const { line, color } = summarize();
  const fields = [...states.values()].map(serviceField);

  const embed = brandEmbed()
    .setColor(color)
    .setAuthor({
      name: "Clover Games",
      iconURL: client.user?.displayAvatarURL({ size: 128 }),
      url: env.WEBSITE_URL,
    })
    .setTitle("📊 État des services")
    .setDescription(`> ${line}`)
    .setFooter({ text: "Actualisation automatique toutes les 60 s" })
    .setTimestamp();

  // Discord plafonne à 25 champs ; le réseau en a 7, la garde est de principe.
  if (fields.length) embed.addFields(fields.slice(0, 25));
  return embed;
}

/** Job (60 s) : vérifie les services et met à jour l'embed persistant. */
export async function tickStatus(client: CloverClient): Promise<void> {
  tickCount++;

  const websiteOk = await checkWebsite();
  updateState(
    "website",
    "🌐 Site web",
    websiteOk,
    websiteOk ? "En ligne" : "Injoignable",
    `[${WEBSITE_HOST}](${env.WEBSITE_URL})`,
  );

  // RCON : vérification plus lourde, une fois sur cinq seulement (5 min).
  const checkRcon = tickCount % 5 === 1;

  const servers = await getServers().catch((err) => {
    logger.warn({ err }, "Registre des serveurs illisible");
    return [];
  });

  // Registre vide (migration pas encore appliquée) : on retombe sur l'adresse
  // publique du .env plutôt que d'afficher un tableau de bord amputé.
  if (!servers.length) {
    const mc = await getMcStatus(true);
    updateState(
      "mc:default",
      "🎮 Serveur Minecraft",
      mc.online,
      mc.online ? "En ligne" : "Hors ligne",
      mc.online
        ? `👥 **${mc.players}** / ${mc.maxPlayers} joueurs\n\`${env.MC_HOST}\``
        : `\`${env.MC_HOST}\``,
    );
    await refreshStatusMessages(client);
    return;
  }

  for (const server of servers) {
    const mc = await getServerStatus(server, true);
    const lines: string[] = [];
    if (mc.online) lines.push(`👥 **${mc.players}** / ${mc.maxPlayers} joueurs`);
    lines.push(`\`${serverAddress(server)}\``);

    if (checkRcon) {
      const rcon = await rconHealthCheck(server.key);
      rconDetails.set(
        server.key,
        rcon.configured ? (rcon.ok ? "🛠️ RCON ok" : "🛠️ RCON injoignable") : null,
      );
    }
    const rconLine = rconDetails.get(server.key);
    if (rconLine) lines.push(rconLine);

    updateState(
      `mc:${server.key}`,
      `${server.emoji} ${server.label}`,
      mc.online,
      mc.online ? "En ligne" : "Hors ligne",
      lines.join("\n"),
    );
  }

  await refreshStatusMessages(client);
}

/** Édite (ou recrée) le message de statut persistant de chaque guilde. */
async function refreshStatusMessages(client: CloverClient): Promise<void> {
  const embed = buildStatusEmbed(client);

  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.statusChannelId) continue;

    const channel = await guild.channels
      .fetch(cfg.statusChannelId)
      .catch(() => null);
    if (!channel?.isSendable()) continue;

    if (cfg.statusMessageId) {
      const message = await channel.messages
        .fetch(cfg.statusMessageId)
        .catch(() => null);
      if (message) {
        await message
          .edit({ embeds: [embed] })
          .catch((err) => logger.warn({ err }, "Édition du statut impossible"));
        continue;
      }
    }

    // Message absent (première fois ou supprimé) → on le recrée
    const sent = await channel.send({ embeds: [embed] }).catch((err) => {
      logger.warn({ err }, "Envoi du message de statut impossible");
      return null;
    });
    if (sent) {
      await updateGuildConfig(guild.id, { statusMessageId: sent.id });
    }
  }
}
