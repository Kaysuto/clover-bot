import type { Guild } from "discord.js";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { botGuildInstallations } from "./schema";
import { getGuildConfig } from "./guild-config";

export async function recordGuildInstallation(guild: Guild): Promise<void> {
  await db
    .insert(botGuildInstallations)
    .values({
      guildId: guild.id,
      guildName: guild.name,
      ownerId: guild.ownerId,
    })
    .onConflictDoUpdate({
      target: botGuildInstallations.guildId,
      set: {
        guildName: guild.name,
        ownerId: guild.ownerId,
        lastSeenAt: sql`now()`,
        removedAt: null,
      },
    });
  await getGuildConfig(guild.id);
}

export async function recordGuildRemoval(guildId: string): Promise<void> {
  await db
    .update(botGuildInstallations)
    .set({ removedAt: new Date(), lastSeenAt: new Date() })
    .where(eq(botGuildInstallations.guildId, guildId));
}
