import {
  AuditLogEvent,
  ChannelType,
  type Guild,
  type GuildBan,
  type GuildMember,
  type NonThreadGuildBasedChannel,
  type PartialGuildMember,
  type Role,
} from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { moduleEnabled } from "../dashboard/modules";
import { findAuditEntry } from "../logs/audit";
import { latestBackup, restoreRoleOverwrites } from "./backups";
import { type IncidentRestore, recordIncident } from "./incidents";
import { DANGEROUS_PERMISSIONS, stripDangerousRoles } from "./permissions";
import { neutralizeBot } from "./bot-quarantine";
import {
  type ChannelSnapshot,
  type GuildSnapshot,
  type IdMap,
  type MessageSnapshot,
  type MessagesSnapshot,
  type RoleSnapshot,
  createChannelFrom,
  createRoleFrom,
  reassignRole,
  repostMessages,
  resolveId,
  snapshotChannel,
  snapshotMessage,
  snapshotRole,
} from "./snapshot";
import { isTrusted } from "./trust";

/**
 * Anti-nuke : un même auteur qui supprime, crée ou bannit en série perd ses
 * rôles sensibles, puis tout ce qu'il a défait est recréé.
 *
 * Les actions sont comptées par auteur dans une fenêtre courte, en mémoire :
 * une rafale coupée par un redémarrage n'est pas vue, perte acceptable pour
 * une fenêtre de quelques secondes. Chaque action garde de quoi s'annuler,
 * capturé au moment de l'événement — après, l'objet supprimé n'existe plus.
 */

type NukeKind =
  | "channelDelete"
  | "roleDelete"
  | "channelCreate"
  | "roleCreate"
  | "ban"
  | "kick"
  | "webhookCreate"
  | "botAdd"
  | "rolePerms";

type NukeClass = "delete" | "ban" | "create";

const KIND_CLASS: Record<NukeKind, NukeClass> = {
  channelDelete: "delete",
  roleDelete: "delete",
  rolePerms: "delete",
  botAdd: "delete",
  ban: "ban",
  kick: "ban",
  channelCreate: "create",
  roleCreate: "create",
  webhookCreate: "create",
};

/** Ordre d'annulation : rôles avant salons (surcharges), catégories avant leurs salons. */
const UNDO_ORDER: NukeKind[] = [
  "roleDelete",
  "rolePerms",
  "channelDelete",
  "ban",
  "kick",
  "channelCreate",
  "roleCreate",
  "webhookCreate",
  "botAdd",
];

interface NukeAction {
  kind: NukeKind;
  at: number;
  /** Rang secondaire d'annulation (catégories d'abord). */
  rank: number;
  /** Annule l'action ; retourne une ligne de compte rendu, ou null. */
  undo: () => Promise<string | null>;
}

const REASON = "Anti-nuke : annulation d'une action en série";
/** Durée pendant laquelle un auteur sanctionné voit ses actions annulées à la volée. */
const PUNISHED_MS = 120_000;

const pending = new Map<string, NukeAction[]>();
const punishedUntil = new Map<string, number>();
/** Identifiants recréés récemment, pour que les salons pointent vers les rôles recréés. */
const recreated = new Map<string, { at: number; map: IdMap }>();

function idMap(guildId: string): IdMap {
  const entry = recreated.get(guildId);
  if (entry && Date.now() - entry.at < 3_600_000) return entry.map;
  const fresh = { at: Date.now(), map: {} as IdMap };
  recreated.set(guildId, fresh);
  return fresh.map;
}

async function record(
  guild: Guild,
  actorId: string | null | undefined,
  action: Omit<NukeAction, "at">,
): Promise<void> {
  if (!actorId) return;
  if (!(await moduleEnabled(guild.id, "antinuke"))) return;
  if (await isTrusted(guild, actorId)) return;
  const cfg = await getGuildConfig(guild.id);

  // Bloc synchrone : lecture, ajout et décision sans `await` entre deux, pour
  // que des événements traités en parallèle ne sanctionnent pas deux fois.
  const key = `${guild.id}:${actorId}`;
  const now = Date.now();
  const entry: NukeAction = { ...action, at: now };

  if ((punishedUntil.get(key) ?? 0) > now) {
    if (cfg.nukeRestore) await entry.undo().catch(() => null);
    return;
  }

  const windowMs = cfg.nukeWindowSec * 1_000;
  const list = (pending.get(key) ?? []).filter((a) => now - a.at < windowMs);
  list.push(entry);
  const cls = KIND_CLASS[action.kind];
  const threshold =
    cls === "delete" ? cfg.nukeDeleteThreshold : cls === "ban" ? cfg.nukeBanThreshold : cfg.nukeCreateThreshold;
  const count = list.filter((a) => KIND_CLASS[a.kind] === cls).length;
  if (threshold <= 0 || count < threshold) {
    pending.set(key, list);
    return;
  }
  pending.delete(key);
  punishedUntil.set(key, now + Math.max(windowMs, PUNISHED_MS));

  await punish(guild, actorId, list, cfg.nukeRestore, cfg.nukeWindowSec);
}

async function punish(
  guild: Guild,
  actorId: string,
  actions: NukeAction[],
  restore: boolean,
  windowSec: number,
): Promise<void> {
  const measures: string[] = [];
  const undoData: IncidentRestore = {};
  const member = await guild.members.fetch(actorId).catch(() => null);

  if (!member) {
    measures.push("Auteur introuvable (déjà parti)");
  } else if (member.id === guild.ownerId) {
    measures.push("⚠️ Propriétaire du serveur : hors d'atteinte");
  } else if (member.user.bot) {
    const ok = await neutralizeBot(member, null, "Anti-nuke : bot auteur d'actions en série");
    measures.push(ok ? "Bot neutralisé (permissions à zéro, en attente de décision)" : "⚠️ Bot hors d'atteinte");
  } else {
    const removed = await stripDangerousRoles(member, "Anti-nuke : actions en série");
    if (removed === null) measures.push("⚠️ Auteur hors d'atteinte (rôle au-dessus du mien)");
    else {
      measures.push(`${removed.length} rôle(s) sensible(s) retiré(s)`);
      if (removed.length) undoData.roles = [{ memberId: member.id, roleIds: removed }];
    }
  }

  if (restore) {
    const ordered = [...actions].sort(
      (a, b) => UNDO_ORDER.indexOf(a.kind) - UNDO_ORDER.indexOf(b.kind) || a.rank - b.rank,
    );
    for (const action of ordered) {
      const line = await action.undo().catch(() => null);
      if (line) measures.push(line);
    }
  }

  const counts = new Map<NukeKind, number>();
  for (const a of actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const LABELS: Record<NukeKind, string> = {
    channelDelete: "salon(s) supprimé(s)",
    roleDelete: "rôle(s) supprimé(s)",
    channelCreate: "salon(s) créé(s)",
    roleCreate: "rôle(s) créé(s)",
    ban: "bannissement(s)",
    kick: "expulsion(s)",
    webhookCreate: "webhook(s) créé(s)",
    botAdd: "bot(s) ajouté(s)",
    rolePerms: "rôle(s) rendu(s) dangereux",
  };
  const detail = [...counts].map(([kind, n]) => `${n} ${LABELS[kind]}`).join(", ");

  await recordIncident(guild, {
    type: "nuke",
    actorId,
    targetId: actorId,
    summary: `<@${actorId}> a enchaîné ${detail} en moins de ${windowSec} s.`,
    measures,
    restore: undoData.roles ? undoData : undefined,
  });
}

// ─── Événements ──────────────────────────────────────────────────────────────

function cachedMessages(channel: NonThreadGuildBasedChannel): MessageSnapshot[] {
  if (!channel.isTextBased()) return [];
  return [...channel.messages.cache.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(snapshotMessage)
    .filter((m): m is MessageSnapshot => m !== null);
}

/** Recrée un salon supprimé, ses messages, et y rattache ses anciens enfants. */
async function recreateChannel(guild: Guild, snap: ChannelSnapshot, fresh: MessageSnapshot[]) {
  const map = idMap(guild.id);
  if (guild.channels.cache.has(resolveId(map, snap.id))) return null;
  const channel = await createChannelFrom(guild, snap, map, REASON);
  map[snap.id] = channel.id;

  const backup = await latestBackup(guild.id);
  const backupMessages = (backup?.messages as MessagesSnapshot | undefined)?.[snap.id] ?? [];
  // Le cache est plus frais que la sauvegarde ; la sauvegarde prend le relais s'il est vide.
  const messages = fresh.length ? fresh : backupMessages;
  const reposted = await repostMessages(channel, messages, REASON);

  if (snap.type === ChannelType.GuildCategory && backup) {
    for (const child of (backup.data as GuildSnapshot).channels) {
      if (child.parentId !== snap.id) continue;
      const current = guild.channels.cache.get(resolveId(map, child.id));
      if (current && !current.isThread() && current.parentId === null)
        await current.setParent(channel.id, { lockPermissions: false, reason: REASON }).catch(() => undefined);
    }
  }
  return `Salon \`${snap.name}\` recréé${reposted ? ` (${reposted} message(s))` : ""}`;
}

async function recreateRole(guild: Guild, snap: RoleSnapshot) {
  const map = idMap(guild.id);
  if (guild.roles.cache.has(resolveId(map, snap.id))) return null;
  const role = await createRoleFrom(guild, snap, REASON);
  map[snap.id] = role.id;

  const backup = await latestBackup(guild.id);
  const backupRole = (backup?.data as GuildSnapshot | undefined)?.roles.find((r) => r.id === snap.id);
  const members = snap.members.length ? snap.members : (backupRole?.members ?? []);
  await reassignRole(guild, role.id, members, REASON);
  if (backup) await restoreRoleOverwrites(guild, snap.id, role.id, backup.data as GuildSnapshot, REASON);
  return `Rôle \`${snap.name}\` recréé (${members.length} porteur(s))`;
}

export async function onChannelDelete(channel: NonThreadGuildBasedChannel): Promise<void> {
  // Capture immédiate : l'objet et son cache de messages disparaissent ensuite.
  const snap = snapshotChannel(channel);
  const messages = cachedMessages(channel);
  const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await record(channel.guild, entry?.executorId, {
    kind: "channelDelete",
    rank: channel.type === ChannelType.GuildCategory ? 0 : 1 + channel.position,
    undo: () => recreateChannel(channel.guild, snap, messages),
  });
}

export async function onRoleDelete(role: Role): Promise<void> {
  if (role.managed) return;
  const snap = snapshotRole(role);
  const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
  await record(role.guild, entry?.executorId, {
    kind: "roleDelete",
    rank: snap.position,
    undo: () => recreateRole(role.guild, snap),
  });
}

export async function onChannelCreate(channel: NonThreadGuildBasedChannel): Promise<void> {
  const entry = await findAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await record(channel.guild, entry?.executorId, {
    kind: "channelCreate",
    rank: 0,
    undo: async () => {
      const ok = await channel
        .delete(REASON)
        .then(() => true)
        .catch(() => false);
      return ok ? `Salon \`${channel.name}\` supprimé` : null;
    },
  });
}

export async function onRoleCreate(role: Role): Promise<void> {
  if (role.managed) return;
  const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
  await record(role.guild, entry?.executorId, {
    kind: "roleCreate",
    rank: 0,
    undo: async () => {
      const ok = await role
        .delete(REASON)
        .then(() => true)
        .catch(() => false);
      return ok ? `Rôle \`${role.name}\` supprimé` : null;
    },
  });
}

/**
 * Permissions dangereuses ajoutées à un rôle. Sur @everyone, c'est ouvrir le
 * serveur à tous d'un coup : annulé tout de suite, sans attendre de seuil.
 */
export async function onRoleUpdate(oldRole: Role, newRole: Role): Promise<void> {
  const gained = newRole.permissions.bitfield & ~oldRole.permissions.bitfield & DANGEROUS_PERMISSIONS;
  if (!gained) return;
  const guild = newRole.guild;
  const entry = await findAuditEntry(guild, AuditLogEvent.RoleUpdate, newRole.id);
  const actorId = entry?.executorId ?? null;
  const previous = oldRole.permissions.bitfield;
  const revert = async () => {
    const ok = await newRole
      .setPermissions(previous, REASON)
      .then(() => true)
      .catch(() => false);
    return ok ? `Permissions de \`${newRole.name}\` remises` : null;
  };

  if (newRole.id === guild.id) {
    if (!(await moduleEnabled(guild.id, "antinuke"))) return;
    if (actorId && (await isTrusted(guild, actorId))) return;
    const line = await revert();
    await recordIncident(guild, {
      type: "everyone-perms",
      actorId,
      targetId: newRole.id,
      summary: `Des permissions dangereuses ont été données à @everyone par ${actorId ? `<@${actorId}>` : "un auteur inconnu"}.`,
      measures: [line ?? "⚠️ Permissions non remises"],
    });
    return;
  }
  await record(guild, actorId, { kind: "rolePerms", rank: 0, undo: revert });
}

export async function onBan(ban: GuildBan): Promise<void> {
  const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  await record(ban.guild, entry?.executorId, {
    kind: "ban",
    rank: 0,
    undo: async () => {
      const ok = await ban.guild.members
        .unban(ban.user.id, REASON)
        .then(() => true)
        .catch(() => false);
      return ok ? `\`@${ban.user.username}\` débanni` : null;
    },
  });
}

/** Expulsion (non réversible : un membre expulsé doit revenir de lui-même). */
export async function onKick(member: GuildMember | PartialGuildMember): Promise<void> {
  const entry = await findAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  if (!entry) return;
  await record(member.guild, entry.executorId, { kind: "kick", rank: 0, undo: async () => null });
}

export async function onWebhookCreate(guild: Guild, actorId: string, undo: () => Promise<string | null>) {
  await record(guild, actorId, { kind: "webhookCreate", rank: 0, undo });
}

export async function onBotAdd(guild: Guild, actorId: string | null, bot: GuildMember) {
  await record(guild, actorId, {
    kind: "botAdd",
    rank: 0,
    undo: async () => {
      const ok = await bot
        .kick(REASON)
        .then(() => true)
        .catch(() => false);
      return ok ? `Bot \`${bot.user.username}\` expulsé` : null;
    },
  });
}

/** Purge des compteurs échus (job) : la carte ne doit pas grossir indéfiniment. */
export function pruneNukeState(): void {
  const now = Date.now();
  for (const [key, list] of pending) {
    if (list.every((a) => now - a.at > 600_000)) pending.delete(key);
  }
  for (const [key, until] of punishedUntil) if (until < now) punishedUntil.delete(key);
  for (const [key, entry] of recreated) if (now - entry.at > 3_600_000) recreated.delete(key);
}
