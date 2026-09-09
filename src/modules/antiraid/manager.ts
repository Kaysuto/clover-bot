import { GuildVerificationLevel, type Guild, type GuildMember } from "discord.js";
import type { CloverClient } from "../../client";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { formatDuration } from "../../lib/duration";
import { ERROR_COLOR, WARN_COLOR, brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { sendLog } from "../logs/channel";

/**
 * Protection de l'entrée du serveur. AutoMod couvre ce qui est écrit ; ici on
 * couvre qui arrive :
 *
 * - **rafale d'arrivées** → verrouillage (invitations coupées, vérification au
 *   maximum) et alerte du staff ;
 * - **compte trop jeune** → quarantaine ou expulsion du seul compte concerné.
 *
 * Aucune action de masse : un verrouillage ferme la porte, il n'expulse
 * personne. Un faux positif doit rester réversible, et l'expulsion d'un compte
 * neuf l'est (contrairement à un bannissement).
 */

/** Arrivées récentes par guilde, pour la détection de rafale. */
const recentJoins = new Map<string, number[]>();

/**
 * Enregistre l'arrivée et retourne vrai si la fenêtre glissante dépasse le
 * seuil. La fenêtre est en mémoire : une rafale coupée par un redémarrage n'est
 * pas détectée, mais le verrouillage qu'elle aurait déclenché, lui, vit en base.
 */
function burstDetected(guildId: string, threshold: number, windowSec: number): boolean {
  const now = Date.now();
  const cutoff = now - windowSec * 1_000;
  const joins = (recentJoins.get(guildId) ?? []).filter((at) => at > cutoff);
  joins.push(now);
  recentJoins.set(guildId, joins);
  return joins.length >= threshold;
}

/**
 * Appelé à chaque arrivée, avant tout le reste : un compte mis en quarantaine
 * ne doit pas d'abord recevoir ses rôles de synchro et son MP de bienvenue.
 * Retourne vrai si le membre a été écarté (expulsé ou mis en quarantaine).
 */
export async function inspectJoin(member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;
  const guild = member.guild;
  const cfg = await getGuildConfig(guild.id);

  if (
    cfg.raidJoinThreshold > 0 &&
    burstDetected(guild.id, cfg.raidJoinThreshold, cfg.raidWindowSec) &&
    !cfg.raidUntil
  ) {
    await enterLockdown(guild, member.id).catch((err: unknown) =>
      logger.error({ err, guildId: guild.id }, "Verrouillage anti-raid impossible"),
    );
  }

  if (cfg.raidMinAccountAgeDays <= 0) return false;
  const ageMs = Date.now() - member.user.createdTimestamp;
  const minAgeMs = cfg.raidMinAccountAgeDays * 86_400_000;
  if (ageMs >= minAgeMs) return false;

  return quarantine(member, ageMs, cfg.raidQuarantineRoleId, cfg.raidAlertChannelId);
}

/** Quarantaine du compte trop jeune, ou expulsion à défaut de rôle configuré. */
async function quarantine(
  member: GuildMember,
  ageMs: number,
  roleId: string | null,
  alertChannelId: string | null,
): Promise<boolean> {
  const age = formatDuration(ageMs);
  const reason = `Compte créé il y a ${age} (contrôle anti-raid)`;

  let outcome: string;
  if (roleId) {
    const ok = await member.roles
      .add(roleId, reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      await alert(
        member.guild,
        alertChannelId,
        brandEmbed()
          .setColor(ERROR_COLOR)
          .setTitle("🛡️ Quarantaine impossible")
          .setDescription(
            `Le rôle de quarantaine n'a pas pu être appliqué à ${member} (permissions ou hiérarchie ?). Le compte reste **libre de ses mouvements**.`,
          )
          .setTimestamp(),
      );
      return false;
    }
    outcome = "mis en quarantaine";
  } else {
    // Le MP part avant l'expulsion : après, le bot ne partage plus de serveur.
    await member
      .send(
        `Ton compte Discord est trop récent pour rejoindre **${member.guild.name}** (créé il y a ${age}). Reviens dans quelques jours — ce n'est pas une sanction.`,
      )
      .catch(() => undefined);
    const ok = await member
      .kick(reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) return false;
    outcome = "expulsé";
  }

  await alert(
    member.guild,
    alertChannelId,
    brandEmbed()
      .setColor(WARN_COLOR)
      .setTitle("🛡️ Compte trop récent")
      .setDescription(`${member.user.tag} a été ${outcome} à son arrivée.`)
      .addFields(
        { name: "Membre", value: `${member} \`${member.id}\``, inline: true },
        { name: "Âge du compte", value: age, inline: true },
      )
      .setTimestamp(),
  );
  logger.info({ userId: member.id, guildId: member.guild.id, outcome }, "Arrivée écartée");
  return true;
}

/**
 * Ferme la porte : invitations coupées et vérification au maximum. L'échéance
 * est écrite en base avant d'agir — un redémarrage ne doit pas laisser un
 * serveur verrouillé sans personne pour le rouvrir (cf. `tickLockdown`).
 */
async function enterLockdown(guild: Guild, triggeredBy: string): Promise<void> {
  const cfg = await getGuildConfig(guild.id);
  const until = new Date(Date.now() + cfg.raidLockdownMinutes * 60_000);

  await updateGuildConfig(guild.id, {
    raidUntil: until,
    raidPreviousVerification: guild.verificationLevel,
  });

  const applied: string[] = [];
  if (cfg.raidPauseInvites) {
    const ok = await guild
      .disableInvites(true)
      .then(() => true)
      .catch(() => false);
    applied.push(ok ? "invitations coupées" : "⚠️ coupure des invitations refusée");
  }
  if (guild.verificationLevel < GuildVerificationLevel.High) {
    const ok = await guild
      .setVerificationLevel(GuildVerificationLevel.High, "Verrouillage anti-raid")
      .then(() => true)
      .catch(() => false);
    applied.push(ok ? "vérification au niveau élevé" : "⚠️ vérification inchangée");
  }

  logger.warn({ guildId: guild.id, until, triggeredBy }, "Verrouillage anti-raid activé");
  await alert(
    guild,
    cfg.raidAlertChannelId,
    brandEmbed()
      .setColor(ERROR_COLOR)
      .setTitle("🚨 Verrouillage anti-raid")
      .setDescription(
        `Plus de **${cfg.raidJoinThreshold}** arrivées en **${cfg.raidWindowSec} s**. Le serveur est verrouillé jusqu'à <t:${Math.floor(until.getTime() / 1_000)}:t>.`,
      )
      .addFields(
        { name: "Mesures", value: applied.join("\n") || "aucune" },
        {
          name: "Lever tout de suite",
          value: "`/config antiraid deverrouiller`",
        },
      )
      .setTimestamp(),
  );
}

/**
 * Rouvre : invitations rétablies et vérification remise à son niveau d'avant.
 * Idempotent — appelable par le job comme par la commande.
 */
export async function liftLockdown(guild: Guild, manual: boolean): Promise<boolean> {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.raidUntil) return false;

  await guild.disableInvites(false).catch(() => undefined);
  if (cfg.raidPreviousVerification !== null) {
    await guild
      .setVerificationLevel(
        cfg.raidPreviousVerification as GuildVerificationLevel,
        "Fin du verrouillage anti-raid",
      )
      .catch(() => undefined);
  }
  await updateGuildConfig(guild.id, { raidUntil: null, raidPreviousVerification: null });

  logger.info({ guildId: guild.id, manual }, "Verrouillage anti-raid levé");
  await alert(
    guild,
    cfg.raidAlertChannelId,
    brandEmbed()
      .setTitle("🔓 Verrouillage levé")
      .setDescription(
        manual
          ? "Le serveur est rouvert (levée manuelle)."
          : "Le serveur est rouvert : l'échéance est passée.",
      )
      .setTimestamp(),
  );
  return true;
}

/**
 * Job (60 s) : lève les verrouillages échus. L'échéance est relue en base, donc
 * un verrouillage posé avant un redémarrage est bien rouvert.
 */
export async function tickLockdown(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.raidUntil || cfg.raidUntil > new Date()) continue;
    await liftLockdown(guild, false).catch((err: unknown) =>
      logger.error({ err, guildId: guild.id }, "Levée du verrouillage impossible"),
    );
  }
}

/** Alerte staff : salon dédié s'il existe, sinon le log « modération ». */
async function alert(
  guild: Guild,
  channelId: string | null,
  embed: ReturnType<typeof brandEmbed>,
): Promise<void> {
  if (channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isSendable()) {
      await channel.send({ embeds: [embed] }).catch(() => undefined);
      return;
    }
  }
  await sendLog(guild, "moderation", embed).catch(() => undefined);
}
