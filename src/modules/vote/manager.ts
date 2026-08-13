import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botMinecraftLinks, botVotes } from "../../db/schema";
import { usersMeta } from "../../db/site-schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";
import { rconBroadcast } from "../../lib/rcon";

export type VoteRow = typeof botVotes.$inferSelect;

export interface RecordVoteInput {
  site: string;
  username: string;
}

export interface RecordVoteResult {
  vote: VoteRow;
  discordId: string | null;
  /** Serveurs Minecraft ayant exécuté la récompense. */
  rewardedOn: string[];
}

/**
 * Enregistre un vote et déclenche les récompenses : commande console pour le
 * joueur, rôle temporaire et annonce Discord si le compte est lié.
 *
 * Le vote est historisé même sans compte lié : la liste des serveurs ne connaît
 * que le pseudo Minecraft, et le joueur doit pouvoir lier son compte plus tard.
 */
export async function recordVote(
  client: CloverClient,
  input: RecordVoteInput,
): Promise<RecordVoteResult> {
  const username = input.username.trim();
  const discordId = await resolveDiscordId(username);

  // Une seule guilde en pratique, mais la config est par guilde : on prend
  // celle où le membre se trouve, sinon la première connue.
  const guild =
    (discordId
      ? client.guilds.cache.find((g) => g.members.cache.has(discordId))
      : null) ?? client.guilds.cache.first();

  const cfg = guild ? await getGuildConfig(guild.id) : null;
  const roleExpiresAt =
    cfg?.voteRoleId && discordId
      ? new Date(Date.now() + cfg.voteRoleHours * 3_600_000)
      : null;

  const [vote] = await db
    .insert(botVotes)
    .values({
      site: input.site.slice(0, 64),
      minecraftUsername: username,
      discordId,
      roleExpiresAt,
      roleRemoved: roleExpiresAt === null,
    })
    .returning();
  if (!vote) throw new Error("Vote non enregistré");

  const rewardedOn = cfg?.voteRconCommand
    ? await rconBroadcast(cfg.voteRconCommand.replaceAll("{player}", username)).catch(
        (err) => {
          logger.warn({ err, username }, "Récompense de vote impossible");
          return [] as string[];
        },
      )
    : [];

  if (guild && cfg && discordId) {
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
                  `🗳️ <@${discordId}> (\`${username}\`) vient de voter sur **${input.site}** — merci ! C'est son **${total}ᵉ** vote.`,
                )
                .setTimestamp(),
            ],
          })
          .catch(() => undefined);
      }
    }
  }

  logger.info({ site: input.site, username, discordId }, "Vote enregistré");
  return { vote, discordId, rewardedOn };
}

/** Pseudo Minecraft → Discord, en interrogeant les deux tables de liaison. */
async function resolveDiscordId(username: string): Promise<string | null> {
  const needle = username.toLowerCase();

  const [site] = await db
    .select({ discordId: usersMeta.discordId })
    .from(usersMeta)
    .where(sql`lower(${usersMeta.minecraftUsername}) = ${needle}`)
    .limit(1);
  if (site?.discordId) return site.discordId;

  const [code] = await db
    .select({ discordId: botMinecraftLinks.discordId })
    .from(botMinecraftLinks)
    .where(sql`lower(${botMinecraftLinks.minecraftUsername}) = ${needle}`)
    .limit(1);
  return code?.discordId ?? null;
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
