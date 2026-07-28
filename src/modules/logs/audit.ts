import {
  type AuditLogEvent,
  type Guild,
  type GuildAuditLogsEntry,
  PermissionFlagsBits,
} from "discord.js";

/** Discord publie l'entrée d'audit juste après l'événement gateway. */
const AUDIT_DELAY_MS = 800;

/**
 * Retrouve « qui a fait quoi » pour une action fraîche (expulsion, suppression
 * de salon…). Best-effort : nécessite la permission « Voir les logs d'audit »,
 * et certaines actions n'y figurent tout simplement pas (départ volontaire).
 * Retourne null plutôt que d'échouer — le log est alors publié sans auteur.
 */
export async function findAuditEntry<T extends AuditLogEvent>(
  guild: Guild,
  type: T,
  targetId: string,
  opts: { maxAgeMs?: number; delayMs?: number } = {},
): Promise<GuildAuditLogsEntry<T> | null> {
  const { maxAgeMs = 10_000, delayMs = AUDIT_DELAY_MS } = opts;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  if (!logs) return null;

  for (const entry of logs.entries.values()) {
    if (Date.now() - entry.createdTimestamp > maxAgeMs) continue;
    if (entry.targetId === targetId) return entry as GuildAuditLogsEntry<T>;
  }
  return null;
}

/** Ligne « Par : @auteur — raison » à ajouter aux logs de modération. */
export function auditFooter(
  entry: { executorId: string | null; reason: string | null } | null,
): string {
  if (!entry?.executorId) return "";
  const reason = entry.reason ? ` — ${entry.reason}` : "";
  return `\n**Par** <@${entry.executorId}>${reason}`;
}
