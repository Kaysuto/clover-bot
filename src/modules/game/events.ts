import type { Guild } from "discord.js";
import { z } from "zod";
import type { CloverClient } from "../../client";
import { env } from "../../config";
import { getGuildConfig } from "../../db/guild-config";
import { BRAND_COLOR, ERROR_COLOR, WARN_COLOR, brandEmbed } from "../../lib/embeds";
import type { IngressReply } from "../../lib/ingress";
import { logger } from "../../lib/logger";
import { getServer } from "../../lib/servers";
import { sendLog } from "../logs/channel";
import {
  applySanction,
  getActiveSanction,
  hasRecentSanction,
  revokeSanction,
  type SanctionType,
} from "../moderation/sanctions";
import { getDiscordIdByPlayer } from "../sync/manager";

/**
 * Événements poussés par le plugin clover-core sur `/game` (cf. `lib/ingress.ts`).
 *
 * C'est le sens retour de tout ce que le bot envoie déjà en RCON : jusqu'ici la
 * modération n'allait que de Discord vers le jeu, et le statut des serveurs
 * n'était connu que par sondage. Ici, le serveur parle.
 */

const sanctionEvent = z.object({
  type: z.literal("sanction"),
  action: z.enum(["BAN", "UNBAN", "MUTE", "UNMUTE", "KICK", "WARN"]),
  player: z.string().min(1).max(32).optional(),
  uuid: z.string().max(36).optional(),
  reason: z.string().max(400).optional(),
  /** Durée en millisecondes ; absente = définitive. */
  durationMs: z.coerce.number().int().positive().optional(),
  /** Auteur de la sanction en jeu, affiché tel quel. */
  actor: z.string().max(64).optional(),
  server: z.string().max(32).optional(),
});

const serverEvent = z.object({
  type: z.literal("server"),
  state: z.enum(["START", "STOP", "CRASH"]),
  server: z.string().max(32).optional(),
  detail: z.string().max(400).optional(),
});

const gameEvent = z.discriminatedUnion("type", [sanctionEvent, serverEvent]);

/**
 * Fenêtre anti-boucle : une sanction posée depuis Discord part en RCON, le
 * plugin la constate et nous la renvoie. Sans ce délai, chaque bannissement
 * s'enregistrerait deux fois.
 */
const ECHO_WINDOW_MS = 2 * 60_000;

/** Guilde de référence : celle du `.env`, sinon la seule connue. */
function mainGuild(client: CloverClient): Guild | null {
  return (
    client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? client.guilds.cache.first() ?? null
  );
}

export async function handleGameEvent(
  client: CloverClient,
  payload: Record<string, unknown>,
): Promise<IngressReply> {
  const parsed = gameEvent.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "payload"} : ${issue.message}`)
      .join(" ; ");
    return { status: 400, message: `Événement invalide (${detail})` };
  }

  const guild = mainGuild(client);
  if (!guild) return { status: 503, message: "Aucune guilde connectée" };

  return parsed.data.type === "sanction"
    ? handleSanctionEvent(client, guild, parsed.data)
    : handleServerEvent(guild, parsed.data);
}

/** Nom lisible d'un serveur du réseau, à défaut sa clé. */
async function serverLabel(key: string | undefined): Promise<string> {
  if (!key) return "le réseau";
  const server = await getServer(key).catch(() => null);
  return server ? `${server.emoji} ${server.label}` : key;
}

async function handleSanctionEvent(
  client: CloverClient,
  guild: Guild,
  event: z.infer<typeof sanctionEvent>,
): Promise<IngressReply> {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.gameSanctionInbound) {
    return { status: 200, message: "Répercussion Discord désactivée" };
  }

  const discordId = await getDiscordIdByPlayer({
    username: event.player,
    uuid: event.uuid,
  });
  if (!discordId) {
    // Cas courant et normal : tous les joueurs n'ont pas lié leur Discord.
    return { status: 200, message: "Aucun compte Discord lié" };
  }

  const target = await client.users.fetch(discordId).catch(() => null);
  if (!target) return { status: 200, message: "Compte Discord introuvable" };

  const reason = event.reason?.trim() || "Sanction appliquée en jeu";
  const origin = `${await serverLabel(event.server)}${event.actor ? ` — par ${event.actor}` : ""}`;
  const fullReason = `${reason} (en jeu : ${origin})`.slice(0, 400);

  if (event.action === "UNBAN" || event.action === "UNMUTE") {
    const type: SanctionType = event.action === "UNBAN" ? "BAN" : "MUTE";
    const active = await getActiveSanction(guild.id, discordId, type);
    if (!active) return { status: 200, message: "Aucune sanction Discord à lever" };
    await revokeSanction(guild, active, client.user?.id ?? discordId, fullReason, {
      // La levée vient du jeu : la renvoyer en RCON la ferait rebondir.
      propagate: false,
    });
    logger.info(
      { player: event.player, discordId, action: event.action },
      "Levée de sanction reçue du jeu",
    );
    return { status: 200, message: "Sanction levée sur Discord" };
  }

  const type: SanctionType = event.action;
  if (type === "BAN" || type === "MUTE") {
    const active = await getActiveSanction(guild.id, discordId, type);
    if (active) return { status: 200, message: "Sanction Discord déjà en cours" };
  } else if (await hasRecentSanction(guild.id, discordId, type, ECHO_WINDOW_MS)) {
    return { status: 200, message: "Sanction déjà enregistrée (écho ignoré)" };
  }

  const result = await applySanction({
    guild,
    target,
    // Le bot est l'auteur côté Discord ; l'auteur en jeu est dans la raison.
    moderator: client.user ?? target,
    type,
    reason: fullReason,
    durationMs: event.durationMs ?? null,
    // Elle vient du jeu : la repropager la ferait tourner en boucle.
    propagate: false,
  });

  logger.info(
    { player: event.player, discordId, action: type, failures: result.failures },
    "Sanction reçue du jeu",
  );
  return {
    status: 200,
    message: result.failures.length
      ? `Sanction Discord partielle : ${result.failures.join(" ")}`
      : "Sanction répercutée sur Discord",
  };
}

const SERVER_STATES = {
  START: { title: "🟢 Serveur démarré", sentence: "vient de démarrer.", color: BRAND_COLOR },
  STOP: { title: "⚪ Serveur arrêté", sentence: "vient de s'arrêter.", color: WARN_COLOR },
  CRASH: {
    title: "🔴 Serveur tombé",
    sentence: "s'est arrêté sans prévenir.",
    color: ERROR_COLOR,
  },
} as const;

async function handleServerEvent(
  guild: Guild,
  event: z.infer<typeof serverEvent>,
): Promise<IngressReply> {
  const cfg = await getGuildConfig(guild.id);
  const state = SERVER_STATES[event.state];
  const label = await serverLabel(event.server);

  const embed = brandEmbed()
    .setColor(state.color)
    .setTitle(state.title)
    .setDescription(`**${label}** ${state.sentence}`)
    .setTimestamp();
  if (event.detail) embed.addFields({ name: "Détail", value: event.detail });

  // Le salon dédié s'il est configuré, sinon le log « serveur » : un incident
  // ne doit pas se perdre parce que personne n'a rempli le réglage.
  if (cfg.gameEventChannelId) {
    const channel = await guild.channels.fetch(cfg.gameEventChannelId).catch(() => null);
    if (channel?.isSendable()) {
      await channel.send({ embeds: [embed] }).catch(() => undefined);
      return { status: 200, message: "Événement annoncé" };
    }
  }
  await sendLog(guild, "serveur", embed).catch(() => undefined);
  return { status: 200, message: "Événement enregistré" };
}
