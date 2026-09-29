import {
  type APIEmbed,
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type Message,
  type NonThreadGuildBasedChannel,
  OverwriteType,
  PermissionFlagsBits,
  type Role,
} from "discord.js";

/**
 * Photographie et recréation de la structure d'un serveur. Partagé par les
 * sauvegardes (restauration à la demande) et l'anti-nuke (recréation immédiate
 * de ce qui vient d'être supprimé). Les bitfields sont stockés en texte : le
 * JSON ne sait pas porter un bigint.
 */

export interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
  managed: boolean;
  /** Porteurs du rôle (tronqué à `MEMBER_LIST_MAX`). */
  members: string[];
}

export interface OverwriteSnapshot {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

export interface ChannelSnapshot {
  id: string;
  type: ChannelType;
  name: string;
  topic: string | null;
  nsfw: boolean;
  parentId: string | null;
  position: number;
  rateLimitPerUser: number;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: OverwriteSnapshot[];
}

export interface GuildSnapshot {
  version: 1;
  everyonePermissions: string;
  roles: RoleSnapshot[];
  channels: ChannelSnapshot[];
}

export interface MessageSnapshot {
  authorName: string;
  avatarUrl: string | null;
  content: string;
  embeds: APIEmbed[];
  attachments: string[];
  createdAt: number;
}

/** Derniers messages par identifiant de salon. */
export type MessagesSnapshot = Record<string, MessageSnapshot[]>;

/** Ancien identifiant → identifiant de l'objet recréé. */
export type IdMap = Record<string, string>;

/**
 * Webhooks de restauration créés par le bot : l'anti-spam et l'anti-webhook
 * les ignorent (une republication de 25 messages ressemble à un flood).
 */
export const ownWebhooks = new Set<string>();

const MEMBER_LIST_MAX = 500;

const TEXT_TYPES = new Set<ChannelType>([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export function resolveId(map: IdMap, id: string): string {
  return map[id] ?? id;
}

export function snapshotRole(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    color: role.colors.primaryColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
    managed: role.managed,
    members: [...role.members.keys()].slice(0, MEMBER_LIST_MAX),
  };
}

export function snapshotChannel(channel: NonThreadGuildBasedChannel): ChannelSnapshot {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    topic: "topic" in channel ? (channel.topic ?? null) : null,
    nsfw: "nsfw" in channel ? channel.nsfw : false,
    parentId: channel.parentId,
    position: channel.position,
    rateLimitPerUser: "rateLimitPerUser" in channel ? (channel.rateLimitPerUser ?? 0) : 0,
    bitrate: "bitrate" in channel ? channel.bitrate : null,
    userLimit: "userLimit" in channel ? channel.userLimit : null,
    overwrites: [...channel.permissionOverwrites.cache.values()].map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield.toString(),
      deny: o.deny.bitfield.toString(),
    })),
  };
}

export function snapshotMessage(message: Message): MessageSnapshot | null {
  if (message.system) return null;
  const embeds = message.embeds.filter((e) => e.data.type === "rich").map((e) => e.toJSON());
  const attachments = [...message.attachments.values()].map((a) => a.url);
  if (!message.content && !embeds.length && !attachments.length) return null;
  return {
    authorName: message.member?.displayName ?? message.author.displayName,
    avatarUrl: message.author.displayAvatarURL({ size: 128 }),
    content: message.content,
    embeds,
    attachments,
    createdAt: message.createdTimestamp,
  };
}

/** Salons éphémères gérés par le bot (vocaux temporaires, tickets…) : jamais restaurés. */
function isEphemeral(channel: GuildBasedChannel, ephemeralParents: ReadonlySet<string>): boolean {
  return channel.parentId !== null && ephemeralParents.has(channel.parentId);
}

/**
 * Photographie complète. Les membres sont chargés d'abord : la liste des
 * porteurs de chaque rôle vient du cache.
 */
export async function captureGuild(
  guild: Guild,
  messagesPerChannel: number,
  ephemeralParents: ReadonlySet<string>,
): Promise<{ data: GuildSnapshot; messages: MessagesSnapshot }> {
  await guild.members.fetch().catch(() => undefined);
  const me = await guild.members.fetchMe();

  const channels = [...guild.channels.cache.values()].filter(
    (c): c is NonThreadGuildBasedChannel => !c.isThread() && !isEphemeral(c, ephemeralParents),
  );

  const messages: MessagesSnapshot = {};
  if (messagesPerChannel > 0) {
    for (const channel of channels) {
      if (!TEXT_TYPES.has(channel.type) || !channel.isTextBased()) continue;
      const perms = channel.permissionsFor(me);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]))
        continue;
      const fetched = await channel.messages
        .fetch({ limit: Math.min(100, messagesPerChannel) })
        .catch(() => null);
      if (!fetched?.size) continue;
      messages[channel.id] = [...fetched.values()]
        .reverse()
        .map(snapshotMessage)
        .filter((m): m is MessageSnapshot => m !== null);
    }
  }

  return {
    data: {
      version: 1,
      everyonePermissions: guild.roles.everyone.permissions.bitfield.toString(),
      roles: [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map(snapshotRole),
      channels: channels.map(snapshotChannel),
    },
    messages,
  };
}

/** Recrée un rôle ; la position est tentée, puis abandonnée si elle dépasse le bot. */
export async function createRoleFrom(guild: Guild, snap: RoleSnapshot, reason: string): Promise<Role> {
  const options = {
    name: snap.name,
    colors: { primaryColor: snap.color },
    hoist: snap.hoist,
    mentionable: snap.mentionable,
    permissions: BigInt(snap.permissions),
    reason,
  };
  return guild.roles
    .create({ ...options, position: snap.position })
    .catch(() => guild.roles.create(options));
}

/** Rend le rôle recréé à ses anciens porteurs encore présents. */
export async function reassignRole(guild: Guild, roleId: string, memberIds: string[], reason: string) {
  for (const memberId of memberIds) {
    const member = guild.members.cache.get(memberId);
    if (!member || member.roles.cache.has(roleId)) continue;
    await member.roles.add(roleId, reason).catch(() => undefined);
  }
}

export function mapOverwrites(guild: Guild, overwrites: OverwriteSnapshot[], map: IdMap) {
  return overwrites
    .map((o) => ({ ...o, id: resolveId(map, o.id) }))
    .filter((o) =>
      o.type === OverwriteType.Role ? guild.roles.cache.has(o.id) : guild.members.cache.has(o.id),
    )
    .map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
}

/**
 * Recrée un salon avec ses surcharges, ses réglages et sa catégorie. Les
 * identifiants de rôles et de catégories passent par `map` : un salon recréé
 * après ses rôles pointe vers les rôles recréés.
 */
export async function createChannelFrom(
  guild: Guild,
  snap: ChannelSnapshot,
  map: IdMap,
  reason: string,
): Promise<NonThreadGuildBasedChannel> {
  const parentId = snap.parentId ? resolveId(map, snap.parentId) : null;
  const parent =
    parentId && guild.channels.cache.get(parentId)?.type === ChannelType.GuildCategory
      ? parentId
      : null;
  const isVoice = snap.type === ChannelType.GuildVoice || snap.type === ChannelType.GuildStageVoice;
  const options = {
    name: snap.name,
    type: snap.type,
    parent,
    position: snap.position,
    nsfw: snap.nsfw,
    permissionOverwrites: mapOverwrites(guild, snap.overwrites, map),
    reason,
    ...(snap.topic && !isVoice ? { topic: snap.topic } : {}),
    ...(snap.rateLimitPerUser ? { rateLimitPerUser: snap.rateLimitPerUser } : {}),
    ...(isVoice && snap.userLimit ? { userLimit: snap.userLimit } : {}),
  } as GuildChannelCreateOptions;

  // Débit refusé (paliers de boost perdus) ou type communautaire indisponible :
  // on retombe sur une version plus simple plutôt que de ne rien recréer.
  const attempts: GuildChannelCreateOptions[] = [
    isVoice && snap.bitrate ? { ...options, bitrate: snap.bitrate } : options,
    options,
  ];
  if (snap.type === ChannelType.GuildAnnouncement || snap.type === ChannelType.GuildForum)
    attempts.push({ ...options, type: ChannelType.GuildText } as GuildChannelCreateOptions);

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return (await guild.channels.create(attempt)) as NonThreadGuildBasedChannel;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Republie des messages au nom et à l'avatar de leur auteur d'origine, via un
 * webhook temporaire. Identifiant et date ne peuvent pas être repris : l'heure
 * d'origine est ajoutée en petit sous chaque message.
 */
export async function repostMessages(
  channel: NonThreadGuildBasedChannel,
  messages: MessageSnapshot[],
  reason: string,
): Promise<number> {
  if (!messages.length || !("createWebhook" in channel) || !channel.isTextBased()) return 0;
  const webhook = await channel.createWebhook({ name: "Restauration", reason }).catch(() => null);
  if (!webhook) return 0;
  ownWebhooks.add(webhook.id);
  let sent = 0;
  try {
    for (const message of messages) {
      const stamp = `-# <t:${Math.floor(message.createdAt / 1_000)}:f>`;
      const content = [message.content, ...message.attachments, stamp]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2_000);
      const ok = await webhook
        .send({
          // Discord refuse ces mots dans le nom d'un webhook.
          username: message.authorName.replace(/discord|clyde/gi, "•").slice(0, 80) || "Membre",
          avatarURL: message.avatarUrl ?? undefined,
          content,
          embeds: message.embeds.slice(0, 10),
          allowedMentions: { parse: [] },
        })
        .then(() => true)
        .catch(() => false);
      if (ok) sent++;
    }
  } finally {
    await webhook.delete(reason).catch(() => undefined);
    // Les derniers messageCreate du webhook arrivent après sa suppression.
    setTimeout(() => ownWebhooks.delete(webhook.id), 60_000).unref();
  }
  return sent;
}
