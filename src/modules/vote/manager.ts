import type { Guild } from "discord.js";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botVotes } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { rconBroadcast } from "../../lib/rcon";
import { getDiscordIdByPlayer } from "../sync/manager";

export type VoteRow = typeof botVotes.$inferSelect;

export interface RecordVoteInput {
  site: string;
  username: string;
}

export interface RecordVoteResult {
  vote: VoteRow;
  discordId: string | null;
  /** Vote déjà reçu dans la fenêtre anti-rejeu : rien n'a été réenregistré. */
  duplicate: boolean;
}

/**
 * Fenêtre anti-rejeu. Une liste qui ne voit pas notre réponse (délai dépassé,
 * erreur réseau) repose le même vote : sans ce garde-fou, la récompense en jeu
 * serait versée deux fois. Bien plus court que l'intervalle réel entre deux
 * votes (24 h chez les listes), assez long pour couvrir les retentatives.
 */
const DEDUP_WINDOW_MS = 10 * 60_000;

/** Guilde de référence : celle où le membre se trouve, sinon la seule connue. */
function resolveGuild(client: CloverClient, discordId: string | null): Guild | null {
  const owning = discordId
    ? client.guilds.cache.find((g) => g.members.cache.has(discordId))
    : undefined;
  return owning ?? client.guilds.cache.first() ?? null;
}

/**
 * Historise un vote, sans rien récompenser : les récompenses sont à la charge
 * de `deliverVoteRewards`, pour que l'appelant HTTP puisse répondre dès que le
 * vote est durable au lieu d'attendre la diffusion RCON.
 *
 * Le vote est historisé même sans compte lié : la liste des serveurs ne connaît
 * que le pseudo Minecraft, et le joueur doit pouvoir lier son compte plus tard.
 */
export async function recordVote(
  client: CloverClient,
  input: RecordVoteInput,
): Promise<RecordVoteResult> {
  const username = input.username.trim();
  const site = input.site.slice(0, 64);
  const discordId = await getDiscordIdByPlayer({ username });

  const replayed = await findRecentVote(site, username);
  if (replayed) {
    logger.info({ site, username }, "Vote déjà enregistré (rejeu ignoré)");
    return { vote: replayed, discordId: replayed.discordId, duplicate: true };
  }

  const guild = resolveGuild(client, discordId);
  const cfg = guild ? await getGuildConfig(guild.id) : null;
  const roleExpiresAt =
    cfg?.voteRoleId && discordId
      ? new Date(Date.now() + cfg.voteRoleHours * 3_600_000)
      : null;

  const [vote] = await db
    .insert(botVotes)
    .values({
      site,
      minecraftUsername: username,
      discordId,
      roleExpiresAt,
      roleRemoved: roleExpiresAt === null,
    })
    .returning();
  if (!vote) throw new Error("Vote non enregistré");

  logger.info({ site, username, discordId }, "Vote enregistré");
  return { vote, discordId, duplicate: false };
}

/** Le même vote a-t-il déjà été reçu à l'instant ? (retentative de la liste) */
async function findRecentVote(site: string, username: string): Promise<VoteRow | null> {
  const [row] = await db
    .select()
    .from(botVotes)
    .where(
      and(
        eq(botVotes.site, site),
        sql`lower(${botVotes.minecraftUsername}) = ${username.toLowerCase()}`,
        gte(botVotes.votedAt, new Date(Date.now() - DEDUP_WINDOW_MS)),
      ),
    )
    .orderBy(desc(botVotes.votedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Récompenses d'un vote : commande console sur tous les serveurs, rôle
 * temporaire et annonce Discord si le compte est lié. Retourne les serveurs
 * Minecraft ayant exécuté la commande.
 *
 * Séparé de l'enregistrement : la diffusion RCON et les appels Discord se
 * comptent en secondes, et la liste qui a posté le vote ne doit pas les
 * attendre — un délai dépassé de son côté la ferait rejouer le vote.
 */
export async function deliverVoteRewards(
  client: CloverClient,
  vote: VoteRow,
): Promise<string[]> {
  const username = vote.minecraftUsername;
  const guild = resolveGuild(client, vote.discordId);
  const cfg = guild ? await getGuildConfig(guild.id) : null;
  if (!cfg) return [];

  const rewardedOn = cfg.voteRconCommand
    ? await rconBroadcast(cfg.voteRconCommand.replaceAll("{player}", username)).catch(
        (err) => {
          logger.warn({ err, username }, "Récompense de vote impossible");
          return [] as string[];
        },
      )
    : [];

  if (guild && vote.discordId) {
    const discordId = vote.discordId;
    if (cfg.voteRoleId) {
      const member = await guild.members.fetch(discordId).catch(() => null);
      await member?.roles
        .add(cfg.voteRoleId, "Vote enregistré")
        .catch((err) => logger.warn({ err, discordId }, "Rôle de vote non attribué"));
    }

    if (cfg.voteChannelId) {
      const channel = await guild.channels.fetch(cfg.voteChannelId).catch(() => null);
      if (channel?.isSendable()) {
        const total = await countVotes(username);
        await channel
          .send({
            embeds: [
              brandEmbed()
                .setDescription(
                  `🗳️ <@${discordId}> (\`${username}\`) vient de voter sur **${vote.site}** — merci ! C'est son **${total}ᵉ** vote.`,
                )
                .setTimestamp(),
            ],
          })
          .catch(() => undefined);
      }
    }
  }

  return rewardedOn;
}

export async function countVotes(username: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(botVotes)
    .where(sql`lower(${botVotes.minecraftUsername}) = ${username.toLowerCase()}`);
  return row?.n ?? 0;
}

/** Classement des voteurs du mois en cours. */
export async function topVoters(
  limit = 10,
): Promise<Array<{ username: string; discordId: string | null; votes: number }>> {
  const rows = await db
    .select({
      username: botVotes.minecraftUsername,
      discordId: sql<string | null>`max(${botVotes.discordId})`,
      votes: sql<number>`count(*)::int`,
    })
    .from(botVotes)
    .where(sql`${botVotes.votedAt} >= date_trunc('month', now())`)
    .groupBy(botVotes.minecraftUsername)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}

/**
 * Job (5 min) : retire les rôles « votant » arrivés à échéance. Comme partout,
 * l'échéance vit en base — un redémarrage ne perd aucun retrait.
 */
export async function tickVoteRoles(client: CloverClient): Promise<void> {
  const due = await db
    .select()
    .from(botVotes)
    .where(
      and(
        eq(botVotes.roleRemoved, false),
        isNotNull(botVotes.roleExpiresAt),
        lte(botVotes.roleExpiresAt, new Date()),
      ),
    );

  for (const vote of due) {
    await db
      .update(botVotes)
      .set({ roleRemoved: true })
      .where(eq(botVotes.id, vote.id));

    if (!vote.discordId) continue;

    // Un vote plus récent peut prolonger le rôle : on ne retire que si plus
    // aucune échéance en cours ne subsiste pour ce membre.
    const [pending] = await db
      .select({ id: botVotes.id })
      .from(botVotes)
      .where(
        and(
          eq(botVotes.discordId, vote.discordId),
          eq(botVotes.roleRemoved, false),
          isNotNull(botVotes.roleExpiresAt),
        ),
      )
      .limit(1);
    if (pending) continue;

    for (const guild of client.guilds.cache.values()) {
      const cfg = await getGuildConfig(guild.id);
      if (!cfg.voteRoleId) continue;
      const member = await guild.members.fetch(vote.discordId).catch(() => null);
      await member?.roles
        .remove(cfg.voteRoleId, "Rôle de vote expiré")
        .catch(() => undefined);
    }
  }
}
