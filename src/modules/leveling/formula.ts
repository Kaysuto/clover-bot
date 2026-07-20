/**
 * Formule de progression (style MEE6) :
 * XP nécessaire pour passer du niveau n au niveau n+1 = 5n² + 50n + 100.
 */
export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** XP cumulé nécessaire pour ATTEINDRE `level`. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

/** Niveau atteint avec `xp` points d'expérience cumulés. */
export function levelFromXp(xp: number): number {
  let level = 0;
  while (xp >= totalXpForLevel(level + 1)) level++;
  return level;
}
