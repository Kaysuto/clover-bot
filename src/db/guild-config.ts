import { eq } from "drizzle-orm";
import { db } from "./index";
import { botGuildConfig } from "./schema";

export type GuildConfig = typeof botGuildConfig.$inferSelect;

/** Retourne la config de la guilde, en créant la ligne par défaut si besoin. */
export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
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
}
