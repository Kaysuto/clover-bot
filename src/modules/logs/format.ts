import { EmbedBuilder, type User } from "discord.js";

/** Palette des logs (couleurs Discord natives, lisibles en clair comme en sombre). */
export const LOG_COLOR = {
  add: 0x57f287, // vert : arrivée, création
  remove: 0xed4245, // rouge : départ, suppression, sanction
  update: 0x5865f2, // blurple : modification
  warn: 0xfee75c, // jaune : à surveiller
} as const;

/** Embed de log : couleur, titre et horodatage automatique. */
export function logEmbed(color: number, title: string): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

/**
 * Mention cliquable + identifiant unique : la mention devient illisible une
 * fois le membre parti, le `@pseudo` reste toujours exploitable.
 */
export function userLine(user: User): string {
  return `<@${user.id}> · \`@${user.username}\``;
}

/** Horodatage Discord : date absolue + relatif, dans le fuseau de chaque lecteur. */
export function timestamp(date: Date | number): string {
  const seconds = Math.floor(new Date(date).getTime() / 1_000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

/** Tronque une valeur pour tenir dans un champ d'embed (1024 caractères). */
export function trim(value: string, max = 1024): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
