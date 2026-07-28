import { type Client, type EmbedBuilder, WebhookClient } from "discord.js";
import type { CloverClient } from "../../client";
import { env, rconConfigured } from "../../config";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { BRAND_COLOR, ERROR_COLOR, WARN_COLOR, brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { getMcStatus } from "../../lib/mc-status";
import { rconHealthCheck } from "../../lib/rcon";

type Health = "up" | "down" | "unknown";

interface ServiceState {
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

const MC_ADDRESS =
  env.MC_PORT === 25565 ? env.MC_HOST : `${env.MC_HOST}:${env.MC_PORT}`;

/** Anti-flap : 2 échecs consécutifs avant de déclarer un service hors ligne. */
const FAIL_THRESHOLD = 2;

const states: Record<"website" | "minecraft" | "rcon", ServiceState> = {
  website: { consecutiveFails: 0, effective: "unknown", detail: "" },
  minecraft: { consecutiveFails: 0, effective: "unknown", detail: "" },
  rcon: { consecutiveFails: 0, effective: "unknown", detail: "" },
};

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
  name: keyof typeof states,
  ok: boolean,
  detail: string,
  extra?: string,
): void {
  const state = states[name];
  const previous = state.effective;
  if (ok) {
    state.consecutiveFails = 0;
    state.effective = "up";
  } else {
    state.consecutiveFails++;
    if (state.consecutiveFails >= FAIL_THRESHOLD) state.effective = "down";
  }
  state.detail = detail;
  state.extra = extra;

  if (previous === "up" && state.effective === "down") {
    void alertDown(name);
  }
}

const SERVICE_LABELS: Record<keyof typeof states, string> = {
  website: "🌐 Site web",
  minecraft: "🎮 Serveur Minecraft",
  rcon: "🛠️ RCON",
};

async function alertDown(name: keyof typeof states): Promise<void> {
  logger.warn({ service: name }, "Service passé HORS LIGNE");
  if (!webhook) return;
  await webhook
    .send({
      embeds: [
        brandEmbed()
          .setColor(ERROR_COLOR)
          .setTitle("🚨 Alerte service")
          .setDescription(
            `**${SERVICE_LABELS[name]}** vient de passer **hors ligne**.`,
          )
          .setTimestamp(),
      ],
    })
    .catch((err) => logger.warn({ err }, "Envoi de l'alerte webhook impossible"));
}

function statusIcon(state: ServiceState): string {
  if (state.effective === "up") return "🟢";
  if (state.effective === "down") return "🔴";
  return "🟡";
}

/** Services réellement surveillés (RCON est facultatif). */
function monitoredStates(): ServiceState[] {
  return rconConfigured
    ? [states.website, states.minecraft, states.rcon]
    : [states.website, states.minecraft];
}

/** Bandeau de synthèse : une phrase + la couleur de l'embed. */
function summarize(): { line: string; color: number } {
  const monitored = monitoredStates();
  const down = monitored.filter((s) => s.effective === "down").length;
  if (down > 0) {
    return {
      line:
        down === 1
          ? "🔴 **Incident en cours** — un service est indisponible"
          : `🔴 **Incident en cours** — ${down} services sont indisponibles`,
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
function serviceField(name: keyof typeof states) {
  const state = states[name];
  const value = [
    `${statusIcon(state)} **${state.detail || "Vérification…"}**`,
    state.extra,
  ]
    .filter(Boolean)
    .join("\n");
  return { name: SERVICE_LABELS[name], value, inline: true };
}

export function buildStatusEmbed(client: Client): EmbedBuilder {
  const { line, color } = summarize();

  const embed = brandEmbed()
    .setColor(color)
    .setAuthor({
      name: "Clover Games",
      iconURL: client.user?.displayAvatarURL({ size: 128 }),
      url: env.WEBSITE_URL,
    })
    .setTitle("📊 État des services")
    .setDescription(`> ${line}`)
    .addFields(
      serviceField("website"),
      serviceField("minecraft"),
      rconConfigured
        ? serviceField("rcon")
        : { name: SERVICE_LABELS.rcon, value: "⚪ **Non configuré**", inline: true },
    )
    .setFooter({ text: "Actualisation automatique toutes les 60 s" })
    .setTimestamp();

  return embed;
}

/** Job (60 s) : vérifie les services et met à jour l'embed persistant. */
export async function tickStatus(client: CloverClient): Promise<void> {
  tickCount++;

  const websiteOk = await checkWebsite();
  updateState(
    "website",
    websiteOk,
    websiteOk ? "En ligne" : "Injoignable",
    `[${WEBSITE_HOST}](${env.WEBSITE_URL})`,
  );

  const mc = await getMcStatus(true);
  updateState(
    "minecraft",
    mc.online,
    mc.online ? "En ligne" : "Hors ligne",
    mc.online
      ? `👥 **${mc.players}** / ${mc.maxPlayers} joueurs\n\`${MC_ADDRESS}\``
      : `\`${MC_ADDRESS}\``,
  );

  // RCON : vérification légère toutes les 5 min seulement
  if (rconConfigured && tickCount % 5 === 1) {
    const rcon = await rconHealthCheck();
    updateState("rcon", rcon.ok, rcon.ok ? "Opérationnel" : "Injoignable");
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
    const sent = await channel
      .send({ embeds: [embed] })
      .catch((err) => {
        logger.warn({ err }, "Envoi du message de statut impossible");
        return null;
      });
    if (sent) {
      await updateGuildConfig(guild.id, { statusMessageId: sent.id });
    }
  }
}
