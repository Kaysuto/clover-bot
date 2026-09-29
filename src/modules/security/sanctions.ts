import type { GuildMember, Message } from "discord.js";

/**
 * Mesures légères communes aux protections de contenu : suppression et
 * exclusion temporaire graduée. Jamais de bannissement automatique.
 */

/** Plafond Discord d'une exclusion temporaire : 28 jours. */
const MAX_TIMEOUT_MS = 28 * 86_400_000;

/** Récidives récentes par membre, pour doubler la durée à chaque fois. */
const offenses = new Map<string, { count: number; at: number }>();

/**
 * Exclusion temporaire, doublée à chaque récidive dans l'heure. Retourne la
 * durée appliquée en minutes, ou null si le membre est hors d'atteinte.
 */
export async function timeoutMember(
  member: GuildMember,
  baseMinutes: number,
  reason: string,
): Promise<number | null> {
  if (baseMinutes <= 0 || !member.moderatable) return null;
  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  const previous = offenses.get(key);
  const count = previous && now - previous.at < 3_600_000 ? previous.count + 1 : 1;
  offenses.set(key, { count, at: now });
  const minutes = Math.min(baseMinutes * 2 ** (count - 1), MAX_TIMEOUT_MS / 60_000);
  const ok = await member
    .timeout(minutes * 60_000, reason)
    .then(() => true)
    .catch(() => false);
  return ok ? minutes : null;
}

export async function deleteQuietly(message: Message): Promise<boolean> {
  return message
    .delete()
    .then(() => true)
    .catch(() => false);
}

export function pruneOffenses(): void {
  const now = Date.now();
  for (const [key, entry] of offenses) if (now - entry.at > 3_600_000) offenses.delete(key);
}
