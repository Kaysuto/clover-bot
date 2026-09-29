import { getGuildConfig } from "../../db/guild-config";
export const MODULE_IDS = [
  "moderation",
  "tickets",
  "logs",
  "welcome",
  "levels",
  "economy",
  "departure",
  "invites",
  "events",
  "antiraid",
  "antinuke",
  "antispam",
  "antiwebhook",
  "quarantaine",
  "antiphishing",
  "verification",
  "nsfw",
  "surveillance",
] as const;
export type DashboardModule = (typeof MODULE_IDS)[number];
/**
 * Protections critiques : seuls le propriétaire et le rôle de sécurité peuvent
 * les couper (cf. `hasSecurityAuthority`). Les rallumer reste ouvert à qui
 * gère le serveur.
 */
export const PROTECTED_MODULES: ReadonlySet<DashboardModule> = new Set([
  "antiraid",
  "antinuke",
  "antispam",
  "antiwebhook",
  "quarantaine",
]);
/** Libellés des modules de sécurité, pour `/securite`. */
export const SECURITY_MODULE_LABELS: Partial<Record<DashboardModule, string>> = {
  antiraid: "Anti-raid",
  antinuke: "Anti-nuke",
  antispam: "Anti-spam",
  antiwebhook: "Anti-webhook",
  quarantaine: "Quarantaine des bots",
  antiphishing: "Anti-phishing",
  verification: "Vérification",
  nsfw: "Filtre NSFW",
  surveillance: "Surveillance du staff et anti-usurpation",
};
export async function moduleEnabled(guildId: string, id: DashboardModule) {
  return !(await getGuildConfig(guildId)).disabledModules.includes(id);
}
export function commandModule(
  command: string,
  subcommand: string | null,
): DashboardModule | null {
  if (command === "sanction" && subcommand !== "lever") return "moderation";
  if (command === "clear") return "moderation";
  if (command === "giveaway" && subcommand === "start") return "events";
  if (command === "ticket" && subcommand === "setup") return "tickets";
  if (command === "boutique" && subcommand === "acheter") return "economy";
  return null;
}
export function componentModule(
  prefix: string,
  action: string,
): DashboardModule | null {
  if (prefix === "ticket" && ["open", "modal"].includes(action))
    return "tickets";
  if (prefix === "giveaway" && action === "enter") return "events";
  if (prefix === "shop" && action === "buy") return "economy";
  return null;
}
