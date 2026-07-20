import { EmbedBuilder } from "discord.js";

/** Vert Clover Games. */
export const BRAND_COLOR = 0x52a96c;
export const ERROR_COLOR = 0xe74c3c;
export const WARN_COLOR = 0xf1c40f;

export function brandEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND_COLOR);
}

export function successEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND_COLOR).setDescription(`✅ ${message}`);
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(ERROR_COLOR).setDescription(`❌ ${message}`);
}
