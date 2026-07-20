import type { Guild, GuildMember } from "discord.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig, type GuildConfig } from "../../db/guild-config";
import { botMinecraftLinks } from "../../db/schema";
import { usersMeta } from "../../db/site-schema";
import { logger } from "../../lib/logger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LinkedAccount {
  minecraftUsername: string;
  minecraftUuid: string | null;
  source: "site" | "code";
}

/**
 * Résout le compte Minecraft lié à un compte Discord.
 * Priorité : lien fait sur le site (users_meta) > lien par code in-game.
 */
export async function getLinkedAccount(
  discordId: string,
): Promise<LinkedAccount | null> {
  const [site] = await db
    .select()
    .from(usersMeta)
    .where(eq(usersMeta.discordId, discordId))
    .limit(1);
  if (site?.minecraftUsername) {
    return {
      minecraftUsername: site.minecraftUsername,
      minecraftUuid: site.minecraftUuid,
      source: "site",
    };
  }

  const [code] = await db
    .select()
    .from(botMinecraftLinks)
    .where(eq(botMinecraftLinks.discordId, discordId))
    .limit(1);
  if (code) {
    return {
      minecraftUsername: code.minecraftUsername,
      minecraftUuid: code.minecraftUuid,
      source: "code",
    };
  }
  return null;
}

export type SyncStatus = "synced" | "not-linked" | "partial";

/**
 * Applique la synchro à un membre : pseudo = pseudo Minecraft + rôle lié.
 * "partial" = lié mais au moins une action a échoué (ex. owner du serveur,
 * que le bot ne peut jamais renommer).
 */
export async function syncMember(
  member: GuildMember,
  cfg?: GuildConfig,
  linked?: LinkedAccount | null,
): Promise<{ status: SyncStatus; username?: string }> {
  cfg ??= await getGuildConfig(member.guild.id);
  linked ??= await getLinkedAccount(member.id);

  if (!linked) {
    if (cfg.linkedRoleId && member.roles.cache.has(cfg.linkedRoleId)) {
      await member.roles
        .remove(cfg.linkedRoleId, "Compte Minecraft délié")
        .catch((err) => logger.warn({ err, userId: member.id }, "Retrait du rôle lié impossible"));
    }
    return { status: "not-linked" };
  }

  let allOk = true;

  if (cfg.syncNicknames && member.displayName !== linked.minecraftUsername) {
    if (member.manageable) {
      try {
        await member.setNickname(
          linked.minecraftUsername,
          "Synchronisation du pseudo Minecraft",
        );
      } catch (err) {
        logger.warn({ err, userId: member.id }, "Renommage impossible");
        allOk = false;
      }
    } else {
      allOk = false; // owner du serveur ou rôle au-dessus du bot
    }
  }

  if (cfg.linkedRoleId && !member.roles.cache.has(cfg.linkedRoleId)) {
    try {
      await member.roles.add(cfg.linkedRoleId, "Compte Minecraft lié");
    } catch (err) {
      logger.warn({ err, userId: member.id }, "Ajout du rôle lié impossible");
      allOk = false;
    }
  }

  return {
    status: allOk ? "synced" : "partial",
    username: linked.minecraftUsername,
  };
}

/** Synchronisation complète de la guilde (job 6 h + /sync tout). */
export async function syncGuild(
  guild: Guild,
): Promise<{ synced: number; partial: number; unlinked: number }> {
  const cfg = await getGuildConfig(guild.id);

  // Précharge tous les liens en 2 requêtes (site prime sur code)
  const links = new Map<string, LinkedAccount>();
  const codeRows = await db.select().from(botMinecraftLinks);
  for (const row of codeRows) {
    links.set(row.discordId, {
      minecraftUsername: row.minecraftUsername,
      minecraftUuid: row.minecraftUuid,
      source: "code",
    });
  }
  const siteRows = await db
    .select()
    .from(usersMeta)
    .where(
      and(isNotNull(usersMeta.discordId), isNotNull(usersMeta.minecraftUsername)),
    );
  for (const row of siteRows) {
    links.set(row.discordId!, {
      minecraftUsername: row.minecraftUsername!,
      minecraftUuid: row.minecraftUuid,
      source: "site",
    });
  }

  const members = await guild.members.fetch();
  let synced = 0;
  let partial = 0;
  let unlinked = 0;

  for (const member of members.values()) {
    if (member.user.bot) continue;
    const linked = links.get(member.id) ?? null;

    // Rien à faire ? On évite l'appel API et le throttle.
    const needsWork =
      linked
        ? (cfg.syncNicknames && member.displayName !== linked.minecraftUsername) ||
          (cfg.linkedRoleId ? !member.roles.cache.has(cfg.linkedRoleId) : false)
        : cfg.linkedRoleId
          ? member.roles.cache.has(cfg.linkedRoleId)
          : false;

    if (!needsWork) {
      if (linked) synced++;
      continue;
    }

    const result = await syncMember(member, cfg, linked);
    if (result.status === "synced") synced++;
    else if (result.status === "partial") partial++;
    else unlinked++;
    await sleep(300); // throttle des éditions membres
  }

  logger.info({ guildId: guild.id, synced, partial, unlinked }, "Synchro terminée");
  return { synced, partial, unlinked };
}
