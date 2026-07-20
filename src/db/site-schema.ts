import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Miroir minimal et STRICTEMENT LECTURE SEULE de la table `users_meta` du
 * site (source de vérité : siteweb/src/lib/db/schema.ts, lignes 111-134).
 *
 * Cette table appartient au site : le bot ne doit JAMAIS y écrire.
 * Ce fichier est volontairement hors de drizzle.config.ts (schema =
 * ./src/db/schema.ts uniquement) pour que drizzle-kit ne la gère pas.
 */
export const usersMeta = pgTable("users_meta", {
  userId: text("user_id").primaryKey(),
  role: text("role").notNull(),
  minecraftUuid: text("minecraft_uuid"),
  minecraftUsername: text("minecraft_username"),
  discordId: text("discord_id"),
});
