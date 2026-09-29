import { randomBytes } from "node:crypto";
import { AuditLogEvent, type EmbedBuilder, type Guild, type GuildBan } from "discord.js";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botNetworkGuilds, botNetworks } from "../../db/schema";
import { logger } from "../../lib/logger";
import { findAuditEntry } from "../logs/audit";
import { LOG_COLOR, logEmbed, userLine } from "../logs/format";
import { isTrusted } from "../security/trust";

/**
 * Réseau de serveurs : des guildes d'un même propriétaire (ou qui se font
 * confiance) partagent bannissements et incidents. Distinct de la propagation
 * RCON vers Minecraft, propre à Clover.
 *
 * Adhésion en deux clés : le propriétaire du réseau émet un code, le
 * propriétaire de la guilde qui rejoint le consomme. Personne d'autre ne peut
 * faire entrer une guilde — une adhésion suffit à faire bannir chez les autres.
 */

export type Network = typeof botNetworks.$inferSelect;
export type NetworkGuild = typeof botNetworkGuilds.$inferSelect;

/** Préfixe des raisons posées par la propagation : sert de garde anti-boucle. */
const NETWORK_PREFIX = "Réseau «";
const CODE_TTL_MS = 24 * 3_600_000;

export async function getMembership(
  guildId: string,
): Promise<{ network: Network; member: NetworkGuild } | null> {
  const [row] = await db
    .select({ network: botNetworks, member: botNetworkGuilds })
    .from(botNetworkGuilds)
    .innerJoin(botNetworks, eq(botNetworks.id, botNetworkGuilds.networkId))
    .where(eq(botNetworkGuilds.guildId, guildId));
  return row ?? null;
}

export async function networkGuilds(networkId: number): Promise<NetworkGuild[]> {
  return db.select().from(botNetworkGuilds).where(eq(botNetworkGuilds.networkId, networkId));
}

export async function createNetwork(guild: Guild, name: string): Promise<Network> {
  return db.transaction(async (tx) => {
    const [network] = await tx
      .insert(botNetworks)
      .values({ name, ownerId: guild.ownerId })
      .returning();
    if (!network) throw new Error("Réseau non créé");
    await tx.insert(botNetworkGuilds).values({ guildId: guild.id, networkId: network.id });
    return network;
  });
}

export async function issueJoinCode(networkId: number): Promise<string> {
  const code = randomBytes(6).toString("base64url");
  await db
    .update(botNetworks)
    .set({ joinCode: code, joinCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS) })
    .where(eq(botNetworks.id, networkId));
  return code;
}

/** Consomme le code (usage unique) ; null si invalide ou expiré. */
export async function joinNetwork(guildId: string, code: string): Promise<Network | null> {
  return db.transaction(async (tx) => {
    const [network] = await tx
      .update(botNetworks)
      .set({ joinCode: null, joinCodeExpiresAt: null })
      .where(and(eq(botNetworks.joinCode, code), gt(botNetworks.joinCodeExpiresAt, new Date())))
      .returning();
    if (!network) return null;
    await tx.insert(botNetworkGuilds).values({ guildId, networkId: network.id });
    return network;
  });
}

/** Quitte le réseau ; le dernier serveur à partir l'emporte avec lui. */
export async function leaveNetwork(guildId: string): Promise<void> {
  const membership = await getMembership(guildId);
  if (!membership) return;
  await db.delete(botNetworkGuilds).where(eq(botNetworkGuilds.guildId, guildId));
  const remaining = await networkGuilds(membership.network.id);
  if (!remaining.length) await db.delete(botNetworks).where(eq(botNetworks.id, membership.network.id));
}

export async function setShareBans(guildId: string, share: boolean): Promise<void> {
  await db.update(botNetworkGuilds).set({ shareBans: share }).where(eq(botNetworkGuilds.guildId, guildId));
}

/** Autres guildes du réseau où le bot est présent. */
async function peers(guild: Guild): Promise<Array<{ guild: Guild; member: NetworkGuild; network: Network }>> {
  const membership = await getMembership(guild.id);
  if (!membership) return [];
  const rows = await networkGuilds(membership.network.id);
  return rows
    .filter((row) => row.guildId !== guild.id)
    .map((row) => ({ guild: guild.client.guilds.cache.get(row.guildId), member: row, network: membership.network }))
    .filter((p): p is { guild: Guild; member: NetworkGuild; network: Network } => Boolean(p.guild));
}

/** Recopie un embed dans le salon réseau de chaque autre serveur. */
export async function forwardToNetwork(origin: Guild, embed: EmbedBuilder): Promise<void> {
  for (const peer of await peers(origin)) {
    const { networkLogChannelId } = await getGuildConfig(peer.guild.id);
    if (!networkLogChannelId) continue;
    const channel = peer.guild.channels.cache.get(networkLogChannelId);
    if (!channel?.isSendable()) continue;
    const copy = logEmbed(embed.data.color ?? LOG_COLOR.warn, embed.data.title ?? "Réseau")
      .setDescription(embed.data.description ?? null)
      .setFields(embed.data.fields ?? [])
      .setFooter({ text: `Réseau « ${peer.network.name} » · ${origin.name}` });
    await channel.send({ embeds: [copy] }).catch(() => undefined);
  }
}

/**
 * Bannissement posé ici → appliqué aux autres serveurs qui partagent. Un
 * bannissement venu lui-même du réseau (posé par le bot, raison préfixée)
 * n'est pas repropagé : sans cette garde, deux serveurs se le renverraient.
 */
export async function propagateBan(ban: GuildBan): Promise<void> {
  const origin = ban.guild;
  const membership = await getMembership(origin.id);
  if (!membership?.member.shareBans) return;

  const entry = await findAuditEntry(origin, AuditLogEvent.MemberBanAdd, ban.user.id);
  // Le bannissement reçu de la passerelle n'a pas toujours sa raison : on la relit.
  const reason =
    entry?.reason ?? ban.reason ?? (await ban.fetch(true).catch(() => null))?.reason ?? null;
  if (reason?.startsWith(NETWORK_PREFIX)) return;

  const networkReason = `${NETWORK_PREFIX} ${membership.network.name} » : banni sur ${origin.name}${reason ? ` — ${reason}` : ""}`.slice(0, 512);
  let applied = 0;
  for (const peer of await peers(origin)) {
    if (!peer.member.shareBans) continue;
    // Un serveur du réseau compromis ne doit pas pouvoir faire bannir
    // l'autorité ou les comptes de confiance des autres.
    if (await isTrusted(peer.guild, ban.user.id)) continue;
    const already = await peer.guild.bans.fetch(ban.user.id).catch(() => null);
    if (already) continue;
    const ok = await peer.guild.bans
      .create(ban.user.id, { reason: networkReason })
      .then(() => true)
      .catch(() => false);
    if (ok) applied++;
  }
  if (!applied) return;
  logger.info({ guildId: origin.id, userId: ban.user.id, applied }, "Bannissement propagé au réseau");
  await forwardToNetwork(
    origin,
    logEmbed(LOG_COLOR.remove, "🔨 Bannissement réseau").setDescription(
      `${userLine(ban.user)} banni sur **${origin.name}**${reason ? ` — ${reason}` : ""}.\nAppliqué ici.`,
    ),
  );
}

/** Levée ici → levée ailleurs, mais seulement des bannissements venus du réseau. */
export async function propagateUnban(ban: GuildBan): Promise<void> {
  const origin = ban.guild;
  const membership = await getMembership(origin.id);
  if (!membership?.member.shareBans) return;

  const entry = await findAuditEntry(origin, AuditLogEvent.MemberBanRemove, ban.user.id);
  if (entry?.executorId === origin.client.user.id && entry.reason?.startsWith(NETWORK_PREFIX)) return;

  for (const peer of await peers(origin)) {
    if (!peer.member.shareBans) continue;
    const existing = await peer.guild.bans.fetch(ban.user.id).catch(() => null);
    if (!existing?.reason?.startsWith(NETWORK_PREFIX)) continue;
    await peer.guild.bans
      .remove(ban.user.id, `${NETWORK_PREFIX} ${membership.network.name} » : débanni sur ${origin.name}`)
      .catch(() => undefined);
  }
}
