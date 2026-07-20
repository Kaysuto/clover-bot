import type { Guild } from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { botInvites, botInviteStats } from "../../db/schema";
import { logger } from "../../lib/logger";

export type InviteRow = typeof botInvites.$inferSelect;

export async function getCachedInvites(guildId: string): Promise<InviteRow[]> {
  return db.select().from(botInvites).where(eq(botInvites.guildId, guildId));
}

export async function upsertInvite(
  guildId: string,
  code: string,
  inviterId: string | null,
  uses: number,
  isVanity = false,
): Promise<void> {
  await db
    .insert(botInvites)
    .values({ guildId, code, inviterId, uses, isVanity })
    .onConflictDoUpdate({
      target: [botInvites.guildId, botInvites.code],
      set: { inviterId, uses, isVanity, updatedAt: new Date() },
    });
}

export async function deleteInvite(guildId: string, code: string): Promise<void> {
  await db
    .delete(botInvites)
    .where(and(eq(botInvites.guildId, guildId), eq(botInvites.code, code)));
}

export async function bumpInviteStat(
  guildId: string,
  userId: string,
  field: "joins" | "leaves",
): Promise<void> {
  await db
    .insert(botInviteStats)
    .values({
      guildId,
      userId,
      joins: field === "joins" ? 1 : 0,
      leaves: field === "leaves" ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [botInviteStats.guildId, botInviteStats.userId],
      set:
        field === "joins"
          ? { joins: sql`${botInviteStats.joins} + 1` }
          : { leaves: sql`${botInviteStats.leaves} + 1` },
    });
}

/**
 * Synchronise le cache d'invitations avec l'état réel Discord.
 *
 * À la toute première synchro (aucune ligne en cache), les `uses` actuels
 * de chaque invitation sont crédités en `seed_uses` à leur créateur : les
 * invitations déjà réalisées avant l'installation du bot sont ainsi
 * comptées. (L'API Discord ne permet pas de savoir rétroactivement QUI a
 * été invité par qui — seuls les totaux sont récupérables.)
 */
export async function syncGuildInvites(guild: Guild): Promise<void> {
  let invites;
  try {
    invites = await guild.invites.fetch();
  } catch (err) {
    logger.warn(
      { err, guildId: guild.id },
      "Lecture des invitations impossible (permission « Gérer le serveur » manquante ?)",
    );
    return;
  }

  const cached = await getCachedInvites(guild.id);
  const isFirstSync = cached.length === 0;

  for (const invite of invites.values()) {
    await upsertInvite(
      guild.id,
      invite.code,
      invite.inviterId,
      invite.uses ?? 0,
    );
  }

  // URL personnalisée (vanity)
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity?.code) {
      await upsertInvite(guild.id, vanity.code, null, vanity.uses ?? 0, true);
    }
  }

  // Invitations supprimées pendant l'absence du bot
  for (const row of cached) {
    if (!row.isVanity && !invites.has(row.code)) {
      await deleteInvite(guild.id, row.code);
    }
  }

  // Seed initial des compteurs historiques
  if (isFirstSync) {
    const perInviter = new Map<string, number>();
    for (const invite of invites.values()) {
      if (!invite.inviterId || !invite.uses) continue;
      perInviter.set(
        invite.inviterId,
        (perInviter.get(invite.inviterId) ?? 0) + invite.uses,
      );
    }
    for (const [userId, uses] of perInviter) {
      await db
        .insert(botInviteStats)
        .values({ guildId: guild.id, userId, seedUses: uses })
        .onConflictDoUpdate({
          target: [botInviteStats.guildId, botInviteStats.userId],
          set: { seedUses: uses },
        });
    }
    logger.info(
      { guildId: guild.id, inviters: perInviter.size },
      "Seed des invitations historiques effectué",
    );
  }
}
