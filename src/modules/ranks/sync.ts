import type { Guild, GuildMember } from "discord.js";
import { eq } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { luckPermsConfigured } from "../../config";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botRankRoles } from "../../db/schema";
import { dashedUuid, getPlayerGroups } from "../../lib/lp-db";
import { logger } from "../../lib/logger";
import { getLinkedAccount } from "../sync/manager";

export type RankRoleRow = typeof botRankRoles.$inferSelect;

export function getRankRoles(guildId: string): Promise<RankRoleRow[]> {
  return db.select().from(botRankRoles).where(eq(botRankRoles.guildId, guildId));
}

export interface RankSyncResult {
  status: "synced" | "not-linked" | "no-uuid" | "unavailable" | "disabled";
  groups: string[];
  added: string[];
  removed: string[];
}

/**
 * Reflète les groupes LuckPerms d'un membre sur ses rôles Discord : ajoute les
 * rôles des groupes qu'il possède, retire ceux des groupes qu'il a perdus.
 *
 * Seuls les rôles déclarés dans `bot_rank_roles` sont touchés — un rôle donné
 * à la main hors de cette table n'est jamais retiré.
 */
export async function syncMemberRanks(
  member: GuildMember,
  mapping?: RankRoleRow[],
): Promise<RankSyncResult> {
  const empty = { groups: [], added: [], removed: [] };
  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.rankSyncEnabled || !luckPermsConfigured) {
    return { status: "disabled", ...empty };
  }

  const rows = mapping ?? (await getRankRoles(member.guild.id));
  if (!rows.length) return { status: "disabled", ...empty };

  const linked = await getLinkedAccount(member.id).catch(() => null);
  if (!linked) return { status: "not-linked", ...empty };
  if (!linked.minecraftUuid) return { status: "no-uuid", ...empty };

  const lp = await getPlayerGroups(dashedUuid(linked.minecraftUuid));
  if (!lp) return { status: "unavailable", ...empty };

  const added: string[] = [];
  const removed: string[] = [];

  for (const row of rows) {
    const role = member.guild.roles.cache.get(row.roleId);
    if (!role) continue;
    const shouldHave = lp.groups.includes(row.lpGroup.toLowerCase());
    const has = member.roles.cache.has(role.id);

    if (shouldHave && !has) {
      const ok = await member.roles
        .add(role, `Grade Minecraft « ${row.lpGroup} »`)
        .then(() => true)
        .catch(() => false);
      if (ok) added.push(role.name);
    } else if (!shouldHave && has) {
      const ok = await member.roles
        .remove(role, `Grade Minecraft « ${row.lpGroup} » perdu`)
        .then(() => true)
        .catch(() => false);
      if (ok) removed.push(role.name);
    }
  }

  return { status: "synced", groups: lp.groups, added, removed };
}

/** Synchronise toute la guilde (job 6 h, en même temps que la synchro des pseudos). */
export async function syncGuildRanks(guild: Guild): Promise<{
  synced: number;
  changed: number;
}> {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.rankSyncEnabled || !luckPermsConfigured) return { synced: 0, changed: 0 };

  const mapping = await getRankRoles(guild.id);
  if (!mapping.length) return { synced: 0, changed: 0 };

  const members = await guild.members.fetch();
  let synced = 0;
  let changed = 0;

  for (const member of members.values()) {
    if (member.user.bot) continue;
    const result = await syncMemberRanks(member, mapping).catch((err) => {
      logger.warn({ err, userId: member.id }, "Synchro des grades impossible");
      return null;
    });
    if (result?.status !== "synced") continue;
    synced++;
    if (result.added.length || result.removed.length) changed++;
  }

  logger.info({ guildId: guild.id, synced, changed }, "Synchro des grades terminée");
  return { synced, changed };
}

/** Job : passe sur toutes les guildes du client. */
export async function tickRankSync(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await syncGuildRanks(guild).catch((err) =>
      logger.error({ err, guildId: guild.id }, "Synchro des grades impossible"),
    );
  }
}
