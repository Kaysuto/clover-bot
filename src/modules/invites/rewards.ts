import type { Guild } from "discord.js";
import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { siteApiConfigured } from "../../config";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import {
  botInviteJoins,
  botInviteTierGrants,
  botInviteTiers,
  botLevels,
} from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { deposit } from "../../lib/site-api";
import { grantXp } from "../leveling/xp";
import { getLinkedAccount } from "../sync/manager";

export type InviteJoinRow = typeof botInviteJoins.$inferSelect;

/**
 * Récompense du parrainage — la partie sensible du module.
 *
 * Un crédit vaut 0,01 € : payer une invitation, c'est payer la création d'un
 * compte. Rien n'est versé à l'arrivée. Chaque ligne mûrit pendant
 * `inviteMaturityDays`, puis n'est validée que si le filleul est encore là,
 * que son compte Discord était déjà ancien à son arrivée, qu'il a prouvé une
 * activité réelle (compte Minecraft lié, ou niveau atteint) et que le parrain
 * n'a pas dépassé son plafond mensuel.
 *
 * Le versement passe par le site (`lib/site-api`), sous une clé d'idempotence
 * dérivée de l'identifiant de la ligne : un réessai ne paie jamais deux fois.
 */

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string };

/** Paliers configurés, du plus petit au plus grand. */
export function getInviteTiers(guildId: string) {
  return db
    .select()
    .from(botInviteTiers)
    .where(eq(botInviteTiers.guildId, guildId))
    .orderBy(asc(botInviteTiers.threshold));
}

/**
 * Paliers par défaut, calibrés sur l'échelle du module `economy` : cent
 * filleuls réels rapportent ~1 110 crédits, l'ordre de grandeur d'un Prestige.
 * Semés une seule fois par guilde — un palier supprimé à la main ne revient pas.
 */
const DEFAULT_TIERS = [
  { threshold: 5, credits: 10 },
  { threshold: 10, credits: 25 },
  { threshold: 25, credits: 75 },
  { threshold: 50, credits: 200 },
  { threshold: 100, credits: 500 },
];

export async function seedInviteTiers(guildId: string): Promise<void> {
  const [existing] = await db
    .select({ id: botInviteTiers.id })
    .from(botInviteTiers)
    .where(eq(botInviteTiers.guildId, guildId))
    .limit(1);
  if (existing) return;

  await db
    .insert(botInviteTiers)
    .values(DEFAULT_TIERS.map((tier) => ({ guildId, ...tier })))
    .onConflictDoNothing();
  logger.info({ guildId }, "Paliers de parrainage par défaut créés");
}

/** Invitations déjà validées pour ce parrain (sert aussi aux paliers). */
async function validatedCount(guildId: string, inviterId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(botInviteJoins)
    .where(
      and(
        eq(botInviteJoins.guildId, guildId),
        eq(botInviteJoins.inviterId, inviterId),
        eq(botInviteJoins.rewardStatus, "REWARDED"),
      ),
    );
  return row?.n ?? 0;
}

/** Invitations validées depuis le début du mois — c'est la vraie soupape. */
async function validatedThisMonth(guildId: string, inviterId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(botInviteJoins)
    .where(
      and(
        eq(botInviteJoins.guildId, guildId),
        eq(botInviteJoins.inviterId, inviterId),
        eq(botInviteJoins.rewardStatus, "REWARDED"),
        sql`${botInviteJoins.rewardedAt} >= date_trunc('month', now())`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Le filleul a-t-il déjà été membre auparavant ? Un aller-retour ne doit pas
 * rapporter une deuxième fois — c'est le montage le plus simple à monter.
 */
async function isRejoin(row: InviteJoinRow): Promise<boolean> {
  const [previous] = await db
    .select({ id: botInviteJoins.id })
    .from(botInviteJoins)
    .where(
      and(
        eq(botInviteJoins.guildId, row.guildId),
        eq(botInviteJoins.memberId, row.memberId),
        lte(botInviteJoins.id, row.id - 1),
      ),
    )
    .limit(1);
  return Boolean(previous);
}

/** Toutes les conditions de validation d'une invitation. */
export async function evaluate(
  guild: Guild,
  cfg: GuildConfig,
  row: InviteJoinRow,
): Promise<Verdict> {
  if (!row.inviterId) return { ok: false, reason: "Inviteur inconnu" };
  if (row.leftAt) return { ok: false, reason: "Le filleul a quitté le serveur" };
  if (row.inviterId === row.memberId) return { ok: false, reason: "Auto-invitation" };

  const member = await guild.members.fetch(row.memberId).catch(() => null);
  if (!member) return { ok: false, reason: "Le filleul n'est plus sur le serveur" };
  if (member.user.bot) return { ok: false, reason: "Compte robot" };

  const ageDays = (row.joinedAt.getTime() - member.user.createdTimestamp) / 86_400_000;
  if (ageDays < cfg.inviteMinAccountAgeDays) {
    return {
      ok: false,
      reason: `Compte créé moins de ${cfg.inviteMinAccountAgeDays} jours avant l'arrivée`,
    };
  }

  if (await isRejoin(row)) {
    return { ok: false, reason: "Le filleul était déjà venu sur le serveur" };
  }

  // Preuve d'activité : compte Minecraft lié, ou à défaut un niveau atteint
  // sur Discord. Le lien est le signal fort — il suppose un compte joué.
  const linked = await getLinkedAccount(row.memberId).catch(() => null);
  if (!linked) {
    if (cfg.inviteRequireLink && cfg.inviteMinLevel <= 0) {
      return { ok: false, reason: "Le filleul n'a pas lié son compte Minecraft" };
    }
    const [level] = await db
      .select({ level: botLevels.level })
      .from(botLevels)
      .where(
        and(eq(botLevels.guildId, row.guildId), eq(botLevels.userId, row.memberId)),
      )
      .limit(1);
    if ((level?.level ?? 0) < cfg.inviteMinLevel) {
      return {
        ok: false,
        reason: `Filleul inactif : ni compte lié, ni niveau ${cfg.inviteMinLevel}`,
      };
    }
  }

  const monthly = await validatedThisMonth(row.guildId, row.inviterId);
  if (monthly >= cfg.inviteMonthlyCap) {
    return {
      ok: false,
      reason: `Plafond mensuel atteint (${cfg.inviteMonthlyCap} invitations)`,
    };
  }

  const inviter = await guild.members.fetch(row.inviterId).catch(() => null);
  if (!inviter) return { ok: false, reason: "Le parrain a quitté le serveur" };

  return { ok: true };
}

interface RewardOutcome {
  xp: number;
  credits: number;
  tiers: Array<{ threshold: number; credits: number }>;
  /** Le site n'a pas répondu : la ligne doit repasser en attente. */
  retry: boolean;
}

/**
 * Verse crédits puis XP pour une invitation validée, paliers compris.
 *
 * L'ordre n'est pas anodin : le versement de crédits est idempotent (clé côté
 * site) donc rejouable, l'XP ne l'est pas. En payant les crédits d'abord, un
 * site injoignable laisse la ligne intacte et réessayable ; l'inverse aurait
 * doublé l'XP à chaque tentative.
 */
async function payout(
  guild: Guild,
  cfg: GuildConfig,
  row: InviteJoinRow,
): Promise<RewardOutcome> {
  const inviterId = row.inviterId!;
  const outcome: RewardOutcome = { xp: 0, credits: 0, tiers: [], retry: false };

  if (cfg.inviteCredits > 0 && siteApiConfigured) {
    const result = await deposit({
      key: `discord:invite:${row.id}`,
      discordId: inviterId,
      amount: cfg.inviteCredits,
      reason: `Parrainage de ${row.memberId}`,
    });
    if (result.ok) {
      outcome.credits = cfg.inviteCredits;
    } else {
      logger.warn(
        { inviterId, join: row.id, error: result.error },
        "Crédits de parrainage non versés — réessai au prochain tour",
      );
      outcome.retry = true;
      return outcome;
    }
  }

  if (cfg.inviteXp > 0) {
    await grantXp(guild, inviterId, cfg.inviteXp, { cfg });
    outcome.xp = cfg.inviteXp;
  }

  // Paliers : évalués après coup, sur le total validé incluant cette ligne.
  const total = (await validatedCount(row.guildId, inviterId)) + 1;
  const tiers = await getInviteTiers(row.guildId);
  for (const tier of tiers) {
    if (total < tier.threshold) continue;

    // L'insertion vaut acquisition : un palier déjà versé lève un conflit et
    // n'est pas rejoué, même si le job repasse.
    const claimed = await db
      .insert(botInviteTierGrants)
      .values({
        guildId: row.guildId,
        userId: inviterId,
        threshold: tier.threshold,
        credits: tier.credits,
      })
      .onConflictDoNothing()
      .returning({ threshold: botInviteTierGrants.threshold });
    if (!claimed.length) continue;

    if (!siteApiConfigured || tier.credits <= 0) {
      outcome.tiers.push({ threshold: tier.threshold, credits: 0 });
      continue;
    }

    const result = await deposit({
      key: `discord:invite-tier:${row.guildId}:${inviterId}:${tier.threshold}`,
      discordId: inviterId,
      amount: tier.credits,
      reason: `Palier de ${tier.threshold} parrainages`,
    });
    if (result.ok) {
      outcome.tiers.push({ threshold: tier.threshold, credits: tier.credits });
    } else {
      // Le versement a échoué : on rend le palier réclamable au prochain tour.
      await db
        .delete(botInviteTierGrants)
        .where(
          and(
            eq(botInviteTierGrants.guildId, row.guildId),
            eq(botInviteTierGrants.userId, inviterId),
            eq(botInviteTierGrants.threshold, tier.threshold),
          ),
        );
      logger.warn(
        { inviterId, threshold: tier.threshold, error: result.error },
        "Palier de parrainage non versé",
      );
    }
  }

  return outcome;
}

/** Prévient le parrain de ce qu'il vient de gagner. */
async function notifyInviter(
  guild: Guild,
  cfg: GuildConfig,
  inviterId: string,
  outcome: RewardOutcome,
): Promise<void> {
  const lines = [`🎉 Ton invitation a été validée sur **${guild.name}** !`];
  if (outcome.xp) lines.push(`✨ +**${outcome.xp}** XP`);
  if (outcome.credits) lines.push(`🪙 +**${outcome.credits}** crédits`);
  for (const tier of outcome.tiers) {
    lines.push(
      tier.credits
        ? `🏆 Palier **${tier.threshold} parrainages** atteint : +**${tier.credits}** crédits`
        : `🏆 Palier **${tier.threshold} parrainages** atteint !`,
    );
  }
  if (lines.length === 1) return;

  const member = await guild.members.fetch(inviterId).catch(() => null);
  await member
    ?.send({ embeds: [brandEmbed().setDescription(lines.join("\n"))] })
    .catch(() => undefined);

  if (!cfg.inviteChannelId) return;
  const channel = await guild.channels.fetch(cfg.inviteChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel
    .send({
      embeds: [
        brandEmbed().setDescription(
          `✅ Invitation validée pour <@${inviterId}> — ${lines.slice(1).join(" · ")}`,
        ),
      ],
    })
    .catch(() => undefined);
}

/**
 * Job (30 min) : traite les invitations arrivées à maturité. Tout est relu en
 * base, donc un arrêt du bot ne perd ni ne double aucune récompense.
 */
export async function tickInviteRewards(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (cfg.inviteXp <= 0 && cfg.inviteCredits <= 0) continue;

    await seedInviteTiers(guild.id).catch((err) =>
      logger.warn({ err, guildId: guild.id }, "Paliers par défaut non créés"),
    );

    const cutoff = new Date(Date.now() - cfg.inviteMaturityDays * 86_400_000);
    const due = await db
      .select()
      .from(botInviteJoins)
      .where(
        and(
          eq(botInviteJoins.guildId, guild.id),
          eq(botInviteJoins.rewardStatus, "PENDING"),
          lte(botInviteJoins.joinedAt, cutoff),
        ),
      )
      .limit(100); // le job repasse : inutile de tout traiter d'un coup

    for (const row of due) {
      try {
        const verdict = await evaluate(guild, cfg, row);
        if (!verdict.ok) {
          await db
            .update(botInviteJoins)
            .set({
              rewardStatus: "REJECTED",
              rewardedAt: new Date(),
              rewardReason: verdict.reason,
            })
            .where(eq(botInviteJoins.id, row.id));
          continue;
        }

        // Marquée AVANT le versement : c'est ce qui empêche l'XP, non
        // idempotente, d'être versée deux fois si le bot tombe en cours de
        // route. Le versement des crédits, lui, est rejouable sans risque.
        await db
          .update(botInviteJoins)
          .set({ rewardStatus: "REWARDED", rewardedAt: new Date() })
          .where(eq(botInviteJoins.id, row.id));

        const outcome = await payout(guild, cfg, row);

        if (outcome.retry) {
          // Le site n'a pas répondu : rien n'a été versé, la ligne redevient
          // traitable au prochain tour.
          await db
            .update(botInviteJoins)
            .set({ rewardStatus: "PENDING", rewardedAt: null })
            .where(eq(botInviteJoins.id, row.id));
          continue;
        }

        await db
          .update(botInviteJoins)
          .set({ xpAwarded: outcome.xp, creditsAwarded: outcome.credits })
          .where(eq(botInviteJoins.id, row.id));

        await notifyInviter(guild, cfg, row.inviterId!, outcome);
      } catch (err) {
        logger.error({ err, join: row.id }, "Récompense de parrainage impossible");
      }
    }
  }
}

/** Compteurs affichés par `/invites` : en attente, validées, refusées. */
export async function inviteRewardSummary(
  guildId: string,
  userId: string,
): Promise<{ pending: number; rewarded: number; rejected: number; credits: number }> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${botInviteJoins.rewardStatus} = 'PENDING')::int`,
      rewarded: sql<number>`count(*) filter (where ${botInviteJoins.rewardStatus} = 'REWARDED')::int`,
      rejected: sql<number>`count(*) filter (where ${botInviteJoins.rewardStatus} = 'REJECTED')::int`,
      credits: sql<number>`coalesce(sum(${botInviteJoins.creditsAwarded}), 0)::int`,
    })
    .from(botInviteJoins)
    .where(
      and(eq(botInviteJoins.guildId, guildId), eq(botInviteJoins.inviterId, userId)),
    );
  return row ?? { pending: 0, rewarded: 0, rejected: 0, credits: 0 };
}
