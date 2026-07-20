const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  j: 86_400_000, // jours (français)
  d: 86_400_000,
};

/**
 * Parse une durée du type "30m", "1h", "2j", "1h30m".
 * Retourne la durée en millisecondes, ou null si invalide.
 */
export function parseDuration(input: string): number | null {
  const matches = input
    .toLowerCase()
    .replace(/\s+/g, "")
    .matchAll(/(\d+)(s|m|h|j|d)/g);
  let total = 0;
  let found = false;
  for (const match of matches) {
    found = true;
    total += Number(match[1]) * (UNIT_MS[match[2] as string] ?? 0);
  }
  return found && total > 0 ? total : null;
}

/** Formate une durée en français : "2 j 3 h 5 min". */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  if (days) parts.push(`${days} j`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (!parts.length) parts.push(`${seconds} s`);
  return parts.join(" ");
}
