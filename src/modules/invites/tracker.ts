import type { GuildMember, PartialGuildMember } from "discord.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { botInviteJoins } from "../../db/schema";
import { logger } from "../../lib/logger";
import { announceInvite } from "./announce";
import {
  bumpInviteStat,
  deleteInvite,
  getCachedInvites,
  upsertInvite,
} from "./cache";

interface Candidate {
  code: string;
  inviterId: string | null;
  disappeared: boolean;
}

/**
 * À l'arrivée d'un membre : re-fetch des invitations et diff des `uses`
 * avec le cache pour identifier l'invitation utilisée.
 */
export async function trackJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) return; // les bots arrivent via OAuth, pas via invitation
  const guild = member.guild;

  let fetched;
  try {
    fetched = await guild.invites.fetch();
  } catch {
    await recordJoin(member, null);
    return;
  }

  const cached = await getCachedInvites(guild.id);
  const known = new Map(cached.filter((r) => !r.isVanity).map((r) => [r.code, r]));

  const increased: Candidate[] = [];
  for (const invite of fetched.values()) {
    const prev = known.get(invite.code);
    if (!prev) {
      // Invitation inconnue du cache déjà consommée (créée + utilisée entre deux syncs)
      if ((invite.uses ?? 0) > 0) {
        increased.push({
          code: invite.code,
          inviterId: invite.inviterId,
          disappeared: false,
        });
      }
    } else if ((invite.uses ?? 0) > prev.uses) {
      increased.push({
        code: invite.code,
        inviterId: invite.inviterId ?? prev.inviterId,
        disappeared: false,
      });
    }
  }

  // Invitations disparues : consommées à leur dernier usage (maxUses atteint)
  // ou simplement expirées — on ne les considère que faute de mieux.
  const disappeared: Candidate[] = [];
  for (const row of known.values()) {
    if (!fetched.has(row.code)) {
      disappeared.push({
        code: row.code,
        inviterId: row.inviterId,
        disappeared: true,
      });
    }
  }

  // Mise à jour du cache
  for (const invite of fetched.values()) {
    await upsertInvite(guild.id, invite.code, invite.inviterId, invite.uses ?? 0);
  }
  for (const c of disappeared) {
    await deleteInvite(guild.id, c.code);
  }

  // Résolution : un seul candidat « uses+1 » = certitude ; sinon vanity ; sinon inconnu.
  let used: Candidate | null = null;
  if (increased.length === 1) {
    used = increased[0]!;
  } else if (increased.length === 0 && disappeared.length === 1) {
    used = disappeared[0]!;
  } else if (increased.length === 0 && guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    const prevVanity = cached.find((r) => r.isVanity);
    if (vanity?.code && (vanity.uses ?? 0) > (prevVanity?.uses ?? 0)) {
      await upsertInvite(guild.id, vanity.code, null, vanity.uses ?? 0, true);
      await recordJoin(member, {
        code: vanity.code,
        inviterId: null,
        disappeared: false,
      }, true);
      return;
    }
  }

  if (!used && increased.length > 1) {
    logger.debug(
      { guildId: guild.id, memberId: member.id },
      "Plusieurs invitations candidates : inviteur inconnu",
    );
  }

  await recordJoin(member, used);
}

async function recordJoin(
  member: GuildMember,
  used: Candidate | null,
  isVanity = false,
): Promise<void> {
  await db.insert(botInviteJoins).values({
    guildId: member.guild.id,
    memberId: member.id,
    inviterId: used?.inviterId ?? null,
    code: used?.code ?? null,
    isVanity,
    // Sans inviteur identifié, il n'y a personne à récompenser : la ligne est
    // close d'emblée pour que le job de maturation ne la reprenne jamais.
    rewardStatus: used?.inviterId ? "PENDING" : "REJECTED",
    rewardReason: used?.inviterId ? null : "Inviteur inconnu",
  });
  if (used?.inviterId) {
    await bumpInviteStat(member.guild.id, used.inviterId, "joins");
  }

  await announceInvite(member, used?.inviterId ?? null, isVanity).catch((err) =>
    logger.warn({ err, memberId: member.id }, "Annonce d'invitation impossible"),
  );
}

/** Au départ d'un membre : clôt son entrée de journal et décrémente l'inviteur. */
export async function trackLeave(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;

  const [join] = await db
    .select()
    .from(botInviteJoins)
    .where(
      and(
        eq(botInviteJoins.guildId, member.guild.id),
        eq(botInviteJoins.memberId, member.id),
        isNull(botInviteJoins.leftAt),
      ),
    )
    .orderBy(desc(botInviteJoins.joinedAt))
    .limit(1);
  if (!join) return;

  await db
    .update(botInviteJoins)
    .set({ leftAt: new Date() })
    .where(eq(botInviteJoins.id, join.id));

  if (join.inviterId) {
    await bumpInviteStat(member.guild.id, join.inviterId, "leaves");
  }
}
