import type { EmbedBuilder, Guild, GuildMember, User } from "discord.js";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botSanctions } from "../../db/schema";
import { formatDuration } from "../../lib/duration";
import { BRAND_COLOR, ERROR_COLOR, WARN_COLOR, brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { rconBroadcast } from "../../lib/rcon";
import { sendLog } from "../logs/channel";
import { getLinkedAccount } from "../sync/manager";

export type SanctionRow = typeof botSanctions.$inferSelect;
export type SanctionType = "WARN" | "MUTE" | "KICK" | "BAN";

/** Libellés et couleurs par type, partagés par les embeds et les logs. */
export const SANCTION_LABELS: Record<SanctionType, string> = {
  WARN: "Avertissement",
  MUTE: "Réduction au silence",
  KICK: "Expulsion",
  BAN: "Bannissement",
};

const SANCTION_ICONS: Record<SanctionType, string> = {
  WARN: "⚠️",
  MUTE: "🔇",
  KICK: "👢",
  BAN: "🔨",
};

/** Le timeout Discord est plafonné à 28 jours par l'API. */
const MAX_TIMEOUT_MS = 28 * 86_400_000;

export interface ApplySanctionInput {
  guild: Guild;
  target: User;
  moderator: User;
  type: SanctionType;
  reason: string;
  /** Durée en ms ; null = définitive. Ignoré pour WARN et KICK. */
  durationMs?: number | null;
  /** Prévenir le membre en message privé avant l'action. */
  notify?: boolean;
}

export interface ApplySanctionResult {
  sanction: SanctionRow;
  /** Actions Discord qui ont échoué (permissions, membre absent…). */
  failures: string[];
  /** Serveurs Minecraft ayant accepté la propagation. */
  propagatedTo: string[];
  minecraftUsername: string | null;
}

/**
 * Applique une sanction : historisation en base, action Discord, propagation
 * Minecraft si le compte est lié, message privé au membre et log modération.
 *
 * L'ordre compte : le message privé part AVANT l'expulsion ou le bannissement,
 * sinon le bot ne partage plus de serveur avec le membre et ne peut plus lui
 * écrire.
 */
export async function applySanction(
  input: ApplySanctionInput,
): Promise<ApplySanctionResult> {
  const { guild, target, moderator, type, reason } = input;
  const cfg = await getGuildConfig(guild.id);
  const durationMs = type === "MUTE" || type === "BAN" ? (input.durationMs ?? null) : null;
  const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;

  const linked = await getLinkedAccount(target.id).catch(() => null);
  const failures: string[] = [];

  const [sanction] = await db
    .insert(botSanctions)
    .values({
      guildId: guild.id,
      userId: target.id,
      moderatorId: moderator.id,
      type,
      reason,
      expiresAt,
      // KICK et WARN n'ont rien à lever : ils sont clos d'emblée.
      active: type === "MUTE" || type === "BAN",
      minecraftUsername: linked?.minecraftUsername ?? null,
    })
    .returning();
  if (!sanction) throw new Error("Sanction non enregistrée");

  if (input.notify !== false) {
    await notifyTarget(guild, target, type, reason, durationMs);
  }

  const member = await guild.members.fetch(target.id).catch(() => null);
  const auditReason = `${SANCTION_LABELS[type]} par ${moderator.tag} — ${reason}`.slice(
    0,
    512,
  );

  switch (type) {
    case "WARN":
      break;
    case "MUTE":
      await applyMute(guild, member, cfg, durationMs, auditReason, failures);
      break;
    case "KICK":
      if (!member) failures.push("Le membre n'est plus sur le serveur.");
      else
        await member
          .kick(auditReason)
          .catch(() => failures.push("Expulsion Discord refusée (permissions ?)."));
      break;
    case "BAN":
      await guild.members
        .ban(target.id, { reason: auditReason })
        .catch(() => failures.push("Bannissement Discord refusé (permissions ?)."));
      break;
  }

  const propagatedTo = await propagate(cfg, type, linked?.minecraftUsername, {
    reason,
    durationMs,
  });

  await sendLog(guild, "moderation", sanctionEmbed(sanction, target, moderator)).catch(
    () => undefined,
  );

  return {
    sanction,
    failures,
    propagatedTo,
    minecraftUsername: linked?.minecraftUsername ?? null,
  };
}

/**
 * Réduction au silence : timeout natif tant que la durée est dans les clous
 * (il survit aux redémarrages du bot et se lève tout seul), rôle muet sinon.
 */
async function applyMute(
  guild: Guild,
  member: GuildMember | null,
  cfg: GuildConfig,
  durationMs: number | null,
  auditReason: string,
  failures: string[],
): Promise<void> {
  if (!member) {
    failures.push("Le membre n'est plus sur le serveur.");
    return;
  }

  if (durationMs && durationMs <= MAX_TIMEOUT_MS) {
    const ok = await member
      .timeout(durationMs, auditReason)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }

  if (!cfg.muteRoleId) {
    failures.push(
      durationMs
        ? "Timeout refusé et aucun rôle muet configuré (`/config moderation role-muet`)."
        : "Un silence sans durée exige un rôle muet (`/config moderation role-muet`).",
    );
    return;
  }
  await member.roles
    .add(cfg.muteRoleId, auditReason)
    .catch(() => failures.push("Ajout du rôle muet refusé (permissions ?)."));
}

/** Lève une sanction encore active (mute ou bannissement). */
export async function revokeSanction(
  guild: Guild,
  sanction: SanctionRow,
  moderatorId: string,
  reason: string,
): Promise<string[]> {
  const cfg = await getGuildConfig(guild.id);
  const failures: string[] = [];

  await db
    .update(botSanctions)
    .set({
      active: false,
      revokedBy: moderatorId,
      revokedAt: new Date(),
      revokeReason: reason,
    })
    .where(eq(botSanctions.id, sanction.id));

  if (sanction.type === "BAN") {
    await guild.bans
      .remove(sanction.userId, reason)
      .catch(() => failures.push("Débannissement Discord impossible (déjà levé ?)."));
  }
  if (sanction.type === "MUTE") {
    const member = await guild.members.fetch(sanction.userId).catch(() => null);
    if (member) {
      await member.timeout(null, reason).catch(() => undefined);
      if (cfg.muteRoleId && member.roles.cache.has(cfg.muteRoleId)) {
        await member.roles
          .remove(cfg.muteRoleId, reason)
          .catch(() => failures.push("Retrait du rôle muet impossible."));
      }
    }
  }

  await propagate(
    cfg,
    sanction.type === "BAN" ? "UNBAN" : "UNMUTE",
    sanction.minecraftUsername,
    { reason, durationMs: null },
  );

  return failures;
}

type PropagationAction = SanctionType | "UNBAN" | "UNMUTE";

/**
 * Répercute la sanction sur les serveurs Minecraft. Diffusée à tous les
 * serveurs dont le RCON est configuré : un bannissement ne vaut rien s'il ne
 * couvre que le lobby.
 */
async function propagate(
  cfg: GuildConfig,
  action: PropagationAction,
  player: string | null | undefined,
  ctx: { reason: string; durationMs: number | null },
): Promise<string[]> {
  if (!cfg.sanctionPropagateMc || !player) return [];

  const template = {
    WARN: null,
    KICK: cfg.mcKickCommand,
    BAN: cfg.mcBanCommand,
    MUTE: cfg.mcMuteCommand,
    UNBAN: cfg.mcUnbanCommand,
    UNMUTE: cfg.mcUnmuteCommand,
  }[action];
  if (!template) return [];

  const command = template
    .replaceAll("{player}", player)
    .replaceAll("{reason}", ctx.reason)
    .replaceAll("{duration}", ctx.durationMs ? formatMcDuration(ctx.durationMs) : "perm");

  const done = await rconBroadcast(command).catch((err) => {
    logger.warn({ err, command }, "Propagation Minecraft impossible");
    return [] as string[];
  });
  if (done.length) {
    logger.info({ action, player, servers: done }, "Sanction propagée en jeu");
  }
  return done;
}

/** Durée au format attendu par les plugins de sanction : « 30m », « 2d ». */
function formatMcDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

async function notifyTarget(
  guild: Guild,
  target: User,
  type: SanctionType,
  reason: string,
  durationMs: number | null,
): Promise<void> {
  const embed = brandEmbed()
    .setColor(type === "WARN" ? WARN_COLOR : ERROR_COLOR)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTitle(`${SANCTION_ICONS[type]} ${SANCTION_LABELS[type]}`)
    .addFields(
      { name: "Raison", value: reason },
      {
        name: "Durée",
        value: durationMs ? formatDuration(durationMs) : "Définitive",
        inline: true,
      },
    )
    .setTimestamp();

  await target.send({ embeds: [embed] }).catch(() => {
    logger.debug({ userId: target.id }, "Sanction non notifiée (MP fermés ?)");
  });
}

/** Embed de log, aussi renvoyé en confirmation au modérateur. */
export function sanctionEmbed(
  sanction: SanctionRow,
  target: User,
  moderator: User,
): EmbedBuilder {
  const type = sanction.type as SanctionType;
  const embed = brandEmbed()
    .setColor(type === "WARN" ? WARN_COLOR : ERROR_COLOR)
    .setTitle(`${SANCTION_ICONS[type]} ${SANCTION_LABELS[type]} · #${sanction.id}`)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: "Membre", value: `${target} \`${target.tag}\``, inline: true },
      { name: "Modérateur", value: `${moderator}`, inline: true },
      {
        name: "Échéance",
        value: sanction.expiresAt
          ? `<t:${Math.floor(sanction.expiresAt.getTime() / 1_000)}:R>`
          : "Définitive",
        inline: true,
      },
      { name: "Raison", value: sanction.reason },
    )
    .setTimestamp(sanction.createdAt);

  if (sanction.minecraftUsername) {
    embed.addFields({
      name: "Compte Minecraft",
      value: `\`${sanction.minecraftUsername}\``,
      inline: true,
    });
  }
  return embed;
}

/** Historique complet d'un membre, du plus récent au plus ancien. */
export function getSanctions(
  guildId: string,
  userId: string,
): Promise<SanctionRow[]> {
  return db
    .select()
    .from(botSanctions)
    .where(and(eq(botSanctions.guildId, guildId), eq(botSanctions.userId, userId)))
    .orderBy(desc(botSanctions.createdAt));
}

export function getSanction(id: number): Promise<SanctionRow | undefined> {
  return db
    .select()
    .from(botSanctions)
    .where(eq(botSanctions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Job (60 s) : lève les sanctions temporaires échues. Rien n'est gardé en
 * mémoire — après un redémarrage, les échéances passées sont traitées au
 * premier tick.
 */
export async function tickSanctions(client: CloverClient): Promise<void> {
  const due = await db
    .select()
    .from(botSanctions)
    .where(
      and(
        eq(botSanctions.active, true),
        isNotNull(botSanctions.expiresAt),
        lte(botSanctions.expiresAt, new Date()),
      ),
    );

  for (const sanction of due) {
    const guild = client.guilds.cache.get(sanction.guildId);
    if (!guild) continue;

    await revokeSanction(guild, sanction, client.user?.id ?? "bot", "Durée écoulée")
      .then(async () => {
        const target = await client.users.fetch(sanction.userId).catch(() => null);
        if (!target) return;
        await sendLog(
          guild,
          "moderation",
          brandEmbed()
            .setColor(BRAND_COLOR)
            .setTitle(`⏳ ${SANCTION_LABELS[sanction.type as SanctionType]} expiré`)
            .setDescription(`${target} \`${target.tag}\` — sanction #${sanction.id}`)
            .setTimestamp(),
        ).catch(() => undefined);
      })
      .catch((err) =>
        logger.error({ err, sanction: sanction.id }, "Levée de sanction impossible"),
      );
  }
}
