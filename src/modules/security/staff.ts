import {
  AuditLogEvent,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type User,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botSanctions } from "../../db/schema";
import { formatDuration } from "../../lib/duration";
import { moduleEnabled } from "../dashboard/modules";
import { findAuditEntry } from "../logs/audit";
import { recordIncident } from "./incidents";
import { hasDangerousPermission, isDangerousRole } from "./permissions";
import { levenshtein, skeleton } from "./text";
import { isTrusted } from "./trust";

/**
 * Surveillance du staff et anti-usurpation (module `surveillance`).
 *
 * - Un rôle sensible donné à un compte à risque est retiré, sauf s'il vient du
 *   propriétaire : c'est la voie classique d'une prise de contrôle (compte
 *   neuf, compte volé fraîchement arrivé, membre sanctionné).
 * - Un membre qui copie le nom ou l'avatar d'un membre du staff est signalé.
 */

// ─── Rôles sensibles ─────────────────────────────────────────────────────────

async function riskReasons(member: GuildMember): Promise<string[]> {
  const cfg = await getGuildConfig(member.guild.id);
  const reasons: string[] = [];
  const accountAge = Date.now() - member.user.createdTimestamp;
  if (accountAge < cfg.staffMinAccountAgeDays * 86_400_000)
    reasons.push(`compte créé il y a ${formatDuration(accountAge)}`);
  const memberAge = member.joinedTimestamp ? Date.now() - member.joinedTimestamp : 0;
  if (memberAge < cfg.staffMinMemberDays * 86_400_000)
    reasons.push(`arrivé il y a ${formatDuration(memberAge)}`);
  if (cfg.raidQuarantineRoleId && member.roles.cache.has(cfg.raidQuarantineRoleId))
    reasons.push("en quarantaine anti-raid");
  const [active] = await db
    .select({ id: botSanctions.id })
    .from(botSanctions)
    .where(
      and(
        eq(botSanctions.guildId, member.guild.id),
        eq(botSanctions.userId, member.id),
        eq(botSanctions.type, "MUTE"),
        eq(botSanctions.active, true),
      ),
    )
    .limit(1);
  if (active) reasons.push("réduit au silence en ce moment");
  return reasons;
}

export async function watchSensitiveRoles(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (oldMember.partial || newMember.user.bot) return;
  const guild = newMember.guild;
  const added = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id) && !role.managed && isDangerousRole(role),
  );
  if (!added.size) return;
  if (!(await moduleEnabled(guild.id, "surveillance"))) return;
  if (await isTrusted(guild, newMember.id)) return;

  const reasons = await riskReasons(newMember);
  if (!reasons.length) return;
  const entry = await findAuditEntry(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
  const executorId = entry?.executorId ?? null;
  // Propriétaire, ou le bot lui-même (annulation d'incident, restauration).
  if (executorId === guild.ownerId || executorId === guild.client.user.id) return;

  const ids = [...added.keys()];
  const removed = newMember.manageable
    ? await newMember.roles
        .remove(ids, "Surveillance du staff : rôle sensible donné à un compte à risque")
        .then(() => true)
        .catch(() => false)
    : false;

  await recordIncident(guild, {
    type: "staff-watch",
    actorId: executorId,
    targetId: newMember.id,
    summary: `${added.map((r) => `${r}`).join(" ")} donné à ${newMember} par ${executorId ? `<@${executorId}>` : "un auteur inconnu"} — ${reasons.join(", ")}. Le propriétaire peut le redonner lui-même, ou annuler cette mesure.`,
    measures: [removed ? "Rôle(s) retiré(s)" : "⚠️ Retrait impossible (hiérarchie)"],
    restore: removed ? { roles: [{ memberId: newMember.id, roleIds: ids }] } : undefined,
  });
}

// ─── Usurpation ──────────────────────────────────────────────────────────────

/** Empreinte perceptuelle (dHash 64 bits) d'avatar, par URL : le hash Discord change à chaque envoi. */
const avatarHashes = new Map<string, Promise<bigint | null>>();
/** Alertes déjà levées (membre + membre du staff imité), pour ne pas répéter. */
const flagged = new Map<string, number>();

async function avatarHash(user: User): Promise<bigint | null> {
  if (!user.avatar) return null;
  const url = user.displayAvatarURL({ extension: "png", size: 64 });
  const hit = avatarHashes.get(url);
  if (hit) return hit;
  const value = (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (!res?.ok) return null;
    const { default: sharp } = await import("sharp");
    const pixels = await sharp(Buffer.from(await res.arrayBuffer()))
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        hash = (hash << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
      }
    }
    return hash;
  })().catch(() => null);
  avatarHashes.set(url, value);
  if (avatarHashes.size > 2_000) avatarHashes.clear();
  return value;
}

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

function nameVariants(member: GuildMember): string[] {
  return [member.displayName, member.user.username, member.user.globalName ?? ""]
    .map(skeleton)
    .filter((n) => n.length >= 4);
}

function staffOf(guild: Guild, securityRoleId: string | null): GuildMember[] {
  return [...guild.members.cache.values()].filter(
    (m) =>
      !m.user.bot &&
      (m.id === guild.ownerId ||
        hasDangerousPermission(m) ||
        (securityRoleId !== null && m.roles.cache.has(securityRoleId))),
  );
}

/** Compare le membre au staff ; retourne le membre imité et la ressemblance. */
async function findImitated(member: GuildMember): Promise<{ staff: GuildMember; how: string } | null> {
  const cfg = await getGuildConfig(member.guild.id);
  const names = nameVariants(member);
  const hash = await avatarHash(member.user);
  for (const staff of staffOf(member.guild, cfg.securityRoleId)) {
    if (staff.id === member.id) continue;
    const staffNames = nameVariants(staff);
    const sameName = names.some((n) => staffNames.some((s) => n === s || levenshtein(n, s, 1) <= 1));
    if (sameName) return { staff, how: "nom" };
    if (hash !== null) {
      const staffHash = await avatarHash(staff.user);
      if (staffHash !== null && hamming(hash, staffHash) <= 5) return { staff, how: "avatar" };
    }
  }
  return null;
}

export async function checkImpersonation(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const guild = member.guild;
  if (!(await moduleEnabled(guild.id, "surveillance"))) return;
  if (hasDangerousPermission(member) || (await isTrusted(guild, member.id))) return;

  const match = await findImitated(member);
  if (!match) return;
  const key = `${guild.id}:${member.id}:${match.staff.id}:${match.how}`;
  if ((flagged.get(key) ?? 0) > Date.now()) return;
  flagged.set(key, Date.now() + 86_400_000);

  const cfg = await getGuildConfig(guild.id);
  const measures = ["Alerte"];
  if (cfg.impersonationQuarantine && cfg.raidQuarantineRoleId) {
    const ok = await member.roles
      .add(cfg.raidQuarantineRoleId, "Anti-usurpation : imitation d'un membre du staff")
      .then(() => true)
      .catch(() => false);
    measures.push(ok ? "Mis en quarantaine" : "⚠️ Quarantaine impossible");
  }
  await recordIncident(guild, {
    type: "usurpation",
    actorId: member.id,
    targetId: match.staff.id,
    summary: `${member} (\`@${member.user.username}\`) imite le ${match.how === "nom" ? "nom" : "avatar"} de ${match.staff} (\`@${match.staff.user.username}\`).`,
    measures,
    shareWithNetwork: false,
  });
}

/** Changement de pseudo ou d'avatar de serveur. */
export async function onMemberProfileChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (
    !oldMember.partial &&
    oldMember.nickname === newMember.nickname &&
    oldMember.avatar === newMember.avatar
  )
    return;
  await checkImpersonation(newMember);
}

/** Changement de nom ou d'avatar global : vérifié dans chaque serveur commun. */
export async function onUserProfileChange(user: User): Promise<void> {
  for (const guild of user.client.guilds.cache.values()) {
    const member = guild.members.cache.get(user.id);
    if (member) await checkImpersonation(member);
  }
}

export function pruneImpersonationState(): void {
  const now = Date.now();
  for (const [key, until] of flagged) if (until < now) flagged.delete(key);
}
