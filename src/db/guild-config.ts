import { eq } from "drizzle-orm";
import { db } from "./index";
import { botGuildConfig } from "./schema";

export type GuildConfig = typeof botGuildConfig.$inferSelect;

/**
 * Cache mémoire de la config, lue à chaque message (XP), à chaque log et à
 * chaque tick de job : sans lui, un serveur actif fait une requête Neon par
 * événement. La promesse est mise en cache (et non sa valeur) pour qu'une
 * rafale de messages sur un cache froid ne déclenche qu'un seul SELECT.
 *
 * Toute écriture passe par `updateGuildConfig`, qui invalide l'entrée ; le TTL
 * n'est qu'un filet de sécurité si la ligne était modifiée hors de ce process.
 */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; value: Promise<GuildConfig> }>();

/** Oublie la config en cache (rechargée au prochain accès). */
export function invalidateGuildConfig(guildId: string): void {
  cache.delete(guildId);
}

/** Retourne la config de la guilde, en créant la ligne par défaut si besoin. */
export function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = loadGuildConfig(guildId).catch((err: unknown) => {
    // Un échec ne doit pas rester collé dans le cache jusqu'au TTL.
    cache.delete(guildId);
    throw err;
  });
  cache.set(guildId, { at: Date.now(), value });
  return value;
}

async function loadGuildConfig(guildId: string): Promise<GuildConfig> {
  const existing = await db.query.botGuildConfig.findFirst({
    where: eq(botGuildConfig.guildId, guildId),
  });
  if (existing) return existing;

  await db.insert(botGuildConfig).values({ guildId }).onConflictDoNothing();
  const created = await db.query.botGuildConfig.findFirst({
    where: eq(botGuildConfig.guildId, guildId),
  });
  if (!created) throw new Error(`Impossible de créer la config pour ${guildId}`);
  return created;
}

export async function updateGuildConfig(
  guildId: string,
  values: Partial<typeof botGuildConfig.$inferInsert>,
): Promise<void> {
  await getGuildConfig(guildId); // garantit l'existence de la ligne
  await db
    .update(botGuildConfig)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(botGuildConfig.guildId, guildId));
  invalidateGuildConfig(guildId);
}
