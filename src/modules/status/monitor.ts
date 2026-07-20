import { type EmbedBuilder, WebhookClient } from "discord.js";
import type { CloverClient } from "../../client";
import { env, rconConfigured } from "../../config";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { BRAND_COLOR, ERROR_COLOR, brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { getMcStatus } from "../../lib/mc-status";
import { rconHealthCheck } from "../../lib/rcon";

type Health = "up" | "down" | "unknown";

interface ServiceState {
  consecutiveFails: number;
  effective: Health;
  detail: string;
}

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

async function checkWebsite(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const start = Date.now();
  try {
    const res = await fetch(env.WEBSITE_URL, {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return { ok: res.status < 400, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

function updateState(
  name: keyof typeof states,
  ok: boolean,
  detail: string,
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

export function buildStatusEmbed(): EmbedBuilder {
  const anyDown = Object.values(states).some((s) => s.effective === "down");
  const lines = [
    `${statusIcon(states.website)} **Site web** — ${states.website.detail || "vérification…"}`,
    `${statusIcon(states.minecraft)} **Serveur Minecraft** — ${states.minecraft.detail || "vérification…"}`,
    rconConfigured
      ? `${statusIcon(states.rcon)} **RCON** — ${states.rcon.detail || "vérification…"}`
      : "⚪ **RCON** — non configuré",
  ];
  return brandEmbed()
    .setColor(anyDown ? ERROR_COLOR : BRAND_COLOR)
    .setTitle("📊 État des services Clover Games")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Actualisation automatique toutes les 60 s" })
    .setTimestamp();
}

/** Job (60 s) : vérifie les services et met à jour l'embed persistant. */
export async function tickStatus(client: CloverClient): Promise<void> {
  tickCount++;

  const website = await checkWebsite();
  updateState(
    "website",
    website.ok,
    website.ok ? `En ligne (${website.latencyMs} ms)` : "Injoignable",
  );

  const mc = await getMcStatus(true);
  updateState(
    "minecraft",
    mc.online,
    mc.online
      ? `${mc.players}/${mc.maxPlayers} joueurs (${mc.latencyMs} ms)`
      : "Hors ligne",
  );

  // RCON : vérification légère toutes les 5 min seulement
  if (rconConfigured && tickCount % 5 === 1) {
    const rcon = await rconHealthCheck();
    updateState(
      "rcon",
      rcon.ok,
      rcon.ok ? `Opérationnel (${rcon.latencyMs} ms)` : "Injoignable",
    );
  }

  await refreshStatusMessages(client);
}

/** Édite (ou recrée) le message de statut persistant de chaque guilde. */
async function refreshStatusMessages(client: CloverClient): Promise<void> {
  const embed = buildStatusEmbed();

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
