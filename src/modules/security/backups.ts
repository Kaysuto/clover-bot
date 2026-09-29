import { ChannelType, type Guild, OverwriteType } from "discord.js";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botBackups, botRestoreJobs } from "../../db/schema";
import { logger } from "../../lib/logger";
import {
  type GuildSnapshot,
  type IdMap,
  type MessagesSnapshot,
  captureGuild,
  createChannelFrom,
  createRoleFrom,
  mapOverwrites,
  reassignRole,
  repostMessages,
  resolveId,
} from "./snapshot";

export type Backup = typeof botBackups.$inferSelect;
export type BackupSummary = Pick<Backup, "id" | "kind" | "label" | "createdBy" | "createdAt">;

const RESTORE_REASON = "Restauration d'une sauvegarde";

/**
 * Catégories dont les salons sont créés et supprimés par le bot lui-même
 * (tickets, candidatures, vocaux temporaires) : restaurer un ticket fermé
 * n'aurait aucun sens.
 */
async function ephemeralParents(guildId: string): Promise<Set<string>> {
  const cfg = await getGuildConfig(guildId);
  return new Set(
    [cfg.ticketCategoryId, cfg.applicationCategoryId, cfg.tempvoiceCategoryId].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

export async function createBackup(
  guild: Guild,
  kind: "auto" | "manuel",
  createdBy: string | null,
  label: string | null = null,
): Promise<BackupSummary> {
  const cfg = await getGuildConfig(guild.id);
  const { data, messages } = await captureGuild(
    guild,
    cfg.backupMessagesPerChannel,
    await ephemeralParents(guild.id),
  );
  const [row] = await db
    .insert(botBackups)
    .values({ guildId: guild.id, kind, createdBy, label, data, messages })
    .returning({
      id: botBackups.id,
      kind: botBackups.kind,
      label: botBackups.label,
      createdBy: botBackups.createdBy,
      createdAt: botBackups.createdAt,
    });
  if (!row) throw new Error("Sauvegarde non enregistrée");
  if (kind === "auto") await pruneAutoBackups(guild.id, cfg.backupRetention);
  return row;
}

/** Ne garde que les N dernières sauvegardes automatiques ; les manuelles restent. */
async function pruneAutoBackups(guildId: string, keep: number): Promise<void> {
  const kept = await db
    .select({ id: botBackups.id })
    .from(botBackups)
    .where(and(eq(botBackups.guildId, guildId), eq(botBackups.kind, "auto")))
    .orderBy(desc(botBackups.id))
    .limit(keep);
  if (!kept.length) return;
  await db.delete(botBackups).where(
    and(
      eq(botBackups.guildId, guildId),
      eq(botBackups.kind, "auto"),
      notInArray(
        botBackups.id,
        kept.map((k) => k.id),
      ),
    ),
  );
}

export async function listBackups(guildId: string, limit = 15): Promise<BackupSummary[]> {
  return db
    .select({
      id: botBackups.id,
      kind: botBackups.kind,
      label: botBackups.label,
      createdBy: botBackups.createdBy,
      createdAt: botBackups.createdAt,
    })
    .from(botBackups)
    .where(eq(botBackups.guildId, guildId))
    .orderBy(desc(botBackups.id))
    .limit(limit);
}

export async function getBackup(guildId: string, id: number): Promise<Backup | null> {
  const [row] = await db
    .select()
    .from(botBackups)
    .where(and(eq(botBackups.guildId, guildId), eq(botBackups.id, id)));
  return row ?? null;
}

/** Dernière sauvegarde, quelle qu'elle soit : source des messages et des porteurs de rôle. */
export async function latestBackup(guildId: string): Promise<Backup | null> {
  const [row] = await db
    .select()
    .from(botBackups)
    .where(eq(botBackups.guildId, guildId))
    .orderBy(desc(botBackups.id))
    .limit(1);
  return row ?? null;
}

export async function deleteBackup(guildId: string, id: number): Promise<boolean> {
  const removed = await db
    .delete(botBackups)
    .where(and(eq(botBackups.guildId, guildId), eq(botBackups.id, id)))
    .returning({ id: botBackups.id });
  return removed.length > 0;
}

/**
 * Job (15 min) : sauvegarde automatique des guildes dont la dernière
 * sauvegarde auto a dépassé l'intervalle. Relit la base : un redémarrage ne
 * décale rien.
 */
export async function tickBackups(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (cfg.backupIntervalHours <= 0) continue;
    const [recent] = await db
      .select({ createdAt: botBackups.createdAt })
      .from(botBackups)
      .where(and(eq(botBackups.guildId, guild.id), eq(botBackups.kind, "auto")))
      .orderBy(desc(botBackups.id))
      .limit(1);
    if (recent && Date.now() - recent.createdAt.getTime() < cfg.backupIntervalHours * 3_600_000)
      continue;
    await createBackup(guild, "auto", null).catch((err: unknown) =>
      logger.error({ err, guildId: guild.id }, "Sauvegarde automatique impossible"),
    );
  }
}

// ─── Restauration ────────────────────────────────────────────────────────────

export interface RestoreReport {
  rolesCreated: number;
  rolesUpdated: number;
  channelsCreated: number;
  channelsUpdated: number;
  messages: number;
}

/**
 * Restauration **différentielle** : recrée le manquant, remet l'existant à
 * l'état sauvegardé, ne supprime jamais ce qui a été ajouté depuis. Chaque
 * création est inscrite dans `idMap` avant de passer à la suivante, pour
 * qu'une reprise ne la refasse pas.
 */
async function runRestore(guild: Guild, jobId: number, backup: Backup): Promise<RestoreReport> {
  const [job] = await db.select().from(botRestoreJobs).where(eq(botRestoreJobs.id, jobId));
  const map: IdMap = { ...((job?.idMap as IdMap | undefined) ?? {}) };
  const data = backup.data as GuildSnapshot;
  const messages = backup.messages as MessagesSnapshot;
  const report: RestoreReport = {
    rolesCreated: 0,
    rolesUpdated: 0,
    channelsCreated: 0,
    channelsUpdated: 0,
    messages: 0,
  };
  const saveMap = () =>
    db.update(botRestoreJobs).set({ idMap: map }).where(eq(botRestoreJobs.id, jobId));

  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetch().catch(() => undefined);
  const me = await guild.members.fetchMe();

  await guild.roles.everyone
    .setPermissions(BigInt(data.everyonePermissions), RESTORE_REASON)
    .catch(() => undefined);

  // Rôles, du plus bas au plus haut, ceux d'intégration exceptés.
  for (const snap of [...data.roles].sort((a, b) => a.position - b.position)) {
    if (snap.managed) continue;
    const existing = guild.roles.cache.get(resolveId(map, snap.id));
    if (existing) {
      if (existing.position >= me.roles.highest.position) continue;
      const differs =
        existing.name !== snap.name ||
        existing.colors.primaryColor !== snap.color ||
        existing.hoist !== snap.hoist ||
        existing.mentionable !== snap.mentionable ||
        existing.permissions.bitfield.toString() !== snap.permissions;
      if (differs) {
        await existing
          .edit({
            name: snap.name,
            colors: { primaryColor: snap.color },
            hoist: snap.hoist,
            mentionable: snap.mentionable,
            permissions: BigInt(snap.permissions),
            reason: RESTORE_REASON,
          })
          .then(() => report.rolesUpdated++)
          .catch(() => undefined);
      }
      continue;
    }
    const role = await createRoleFrom(guild, snap, RESTORE_REASON).catch(() => null);
    if (!role) continue;
    map[snap.id] = role.id;
    await saveMap();
    report.rolesCreated++;
    await reassignRole(guild, role.id, snap.members, RESTORE_REASON);
  }

  // Catégories d'abord : les autres salons s'y rattachent.
  const channels = [...data.channels].sort(
    (a, b) =>
      Number(b.type === ChannelType.GuildCategory) - Number(a.type === ChannelType.GuildCategory) ||
      a.position - b.position,
  );
  for (const snap of channels) {
    const existing = guild.channels.cache.get(resolveId(map, snap.id));
    if (existing && !existing.isThread()) {
      // Fusion et non remplacement : une surcharge ajoutée depuis la sauvegarde
      // reste en place, seules celles de la sauvegarde sont remises à leur valeur.
      const saved = mapOverwrites(guild, snap.overwrites, map);
      const savedIds = new Set(saved.map((o) => o.id));
      const kept = [...existing.permissionOverwrites.cache.values()]
        .filter((o) => !savedIds.has(o.id))
        .map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
      const same =
        existing.name === snap.name &&
        saved.every((o) => {
          const cur = existing.permissionOverwrites.cache.get(o.id);
          return cur && cur.allow.bitfield === o.allow && cur.deny.bitfield === o.deny;
        });
      if (!same) {
        await existing
          .edit({ name: snap.name, permissionOverwrites: [...kept, ...saved], reason: RESTORE_REASON })
          .then(() => report.channelsUpdated++)
          .catch(() => undefined);
      }
      continue;
    }
    const channel = await createChannelFrom(guild, snap, map, RESTORE_REASON).catch(() => null);
    if (!channel) continue;
    map[snap.id] = channel.id;
    await saveMap();
    report.channelsCreated++;
    report.messages += await repostMessages(channel, messages[snap.id] ?? [], RESTORE_REASON);
  }
  return report;
}

/** Lance une restauration suivie en base ; l'appelant reçoit le rapport à la fin. */
/**
 * Guildes en cours de restauration : deux restaurations simultanées liraient
 * le même cache et recréeraient chaque rôle et salon manquant en double.
 */
const restoring = new Set<string>();

export async function restoreBackup(
  guild: Guild,
  backupId: number,
  requestedBy: string,
): Promise<RestoreReport> {
  const backup = await getBackup(guild.id, backupId);
  if (!backup) throw new Error("Sauvegarde introuvable");
  // Verrou pris sans `await` entre le test et la prise : un double clic ne passe pas.
  if (restoring.has(guild.id)) throw new Error("Une restauration est déjà en cours sur ce serveur");
  restoring.add(guild.id);
  try {
    const [running] = await db
      .select({ id: botRestoreJobs.id })
      .from(botRestoreJobs)
      .where(and(eq(botRestoreJobs.guildId, guild.id), eq(botRestoreJobs.status, "running")))
      .limit(1);
    if (running) throw new Error("Une restauration est déjà en cours sur ce serveur");
    const [job] = await db
      .insert(botRestoreJobs)
      .values({ guildId: guild.id, backupId, requestedBy })
      .returning({ id: botRestoreJobs.id });
    if (!job) throw new Error("Restauration non enregistrée");
    return await finishJob(guild, job.id, backup);
  } finally {
    restoring.delete(guild.id);
  }
}

async function finishJob(guild: Guild, jobId: number, backup: Backup): Promise<RestoreReport> {
  try {
    const report = await runRestore(guild, jobId, backup);
    await db
      .update(botRestoreJobs)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(botRestoreJobs.id, jobId));
    return report;
  } catch (err) {
    await db
      .update(botRestoreJobs)
      .set({ status: "failed", error: String(err), finishedAt: new Date() })
      .where(eq(botRestoreJobs.id, jobId));
    throw err;
  }
}

/** Au démarrage : reprend les restaurations interrompues par un redémarrage. */
export async function resumeRestores(client: CloverClient): Promise<void> {
  const jobs = await db.select().from(botRestoreJobs).where(eq(botRestoreJobs.status, "running"));
  for (const job of jobs) {
    const guild = client.guilds.cache.get(job.guildId);
    const backup = guild ? await getBackup(job.guildId, job.backupId) : null;
    if (!guild || !backup) {
      await db
        .update(botRestoreJobs)
        .set({ status: "failed", error: "Serveur ou sauvegarde disparus", finishedAt: new Date() })
        .where(eq(botRestoreJobs.id, job.id));
      continue;
    }
    logger.info({ guildId: guild.id, jobId: job.id }, "Reprise d'une restauration");
    restoring.add(guild.id);
    await finishJob(guild, job.id, backup)
      .catch((err: unknown) => logger.error({ err, jobId: job.id }, "Reprise de restauration impossible"))
      .finally(() => restoring.delete(guild.id));
  }
}

/** Surcharges d'un rôle recréé, reposées sur les salons qui le citaient dans la sauvegarde. */
export async function restoreRoleOverwrites(
  guild: Guild,
  oldRoleId: string,
  newRoleId: string,
  data: GuildSnapshot,
  reason: string,
): Promise<void> {
  for (const snap of data.channels) {
    const overwrite = snap.overwrites.find(
      (o) => o.id === oldRoleId && o.type === OverwriteType.Role,
    );
    if (!overwrite) continue;
    const channel = guild.channels.cache.get(snap.id);
    if (!channel || channel.isThread()) continue;
    await channel
      .edit({
        permissionOverwrites: [
          ...[...channel.permissionOverwrites.cache.values()]
            .filter((o) => o.id !== newRoleId)
            .map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
          {
            id: newRoleId,
            type: OverwriteType.Role,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny),
          },
        ],
        reason,
      })
      .catch(() => undefined);
  }
}
