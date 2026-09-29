import { domainToUnicode } from "node:url";
import { levenshtein, skeleton } from "./text";

/**
 * Détection pure (sans Discord ni réseau) des liens d'hameçonnage : liste de
 * blocage, imitation des marques visées, et texte d'appât « Nitro gratuit ».
 */

/** Domaines légitimes, sous-domaines compris. */
export const SAFE_DOMAINS = [
  "discord.com",
  "discord.gg",
  "discord.gift",
  "discord.media",
  "discord.new",
  "discord.dev",
  "discordapp.com",
  "discordapp.net",
  "discordstatus.com",
  "discord.js.org",
  "discordjs.guide",
  "discords.com",
  "discord.me",
  "discord.bio",
  "steamcommunity.com",
  "steampowered.com",
  "steamstatic.com",
  "clovergames.fr",
  "youtube.com",
  "youtu.be",
  "twitch.tv",
  "twitter.com",
  "x.com",
  "github.com",
  "google.com",
  "tenor.com",
  "giphy.com",
  "imgur.com",
];

/** Marques imitées par les arnaques visant Discord. */
const BRANDS = ["discord", "discordapp", "steamcommunity", "steampowered"];

/** Mots d'appât qui, accolés à une marque exacte, trahissent un faux domaine. */
const BAIT_WORDS = /gift|nitro|free|promo|claim|airdrop|reward|login|verify|auth|drop/;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+|\bwww\.[^\s<>"'`)\]]+/gi;

export function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

/** Hôte normalisé (unicode, sans `www.` ni point final), null si illisible. */
export function hostOf(rawUrl: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const host = domainToUnicode(url.hostname.toLowerCase()) || url.hostname.toLowerCase();
    return host.replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isSafeHost(host: string, extraAllowed: readonly string[] = []): boolean {
  return [...SAFE_DOMAINS, ...extraAllowed].some((d) => matchesDomain(host, d.toLowerCase()));
}

export type PhishingVerdict = "liste" | "imitation" | null;

/**
 * Verdict pour un hôte : présent dans la liste de blocage (ou sous-domaine
 * d'un domaine listé), ou imitation d'une marque (sosie de lettres, faute de
 * frappe, marque exacte accolée à un mot d'appât).
 */
export function classifyHost(
  host: string,
  blocklist: ReadonlySet<string>,
  extraAllowed: readonly string[] = [],
): PhishingVerdict {
  if (isSafeHost(host, extraAllowed)) return null;

  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocklist.has(labels.slice(i).join("."))) return "liste";
  }

  // Le TLD ne porte pas la marque ; le reste est découpé en mots.
  const tokens = labels.slice(0, -1).flatMap((label) => label.split("-")).filter(Boolean);
  for (const token of tokens) {
    const shape = skeleton(token);
    for (const brand of BRANDS) {
      if (token === brand) {
        if (BAIT_WORDS.test(host)) return "imitation";
        continue;
      }
      // Sosie visuel : « dіscord » (i cyrillique), « disc0rd »…
      if (shape === skeleton(brand)) return "imitation";
      // Faute de frappe : même longueur ou plus (« stream » n'imite pas « steam »).
      const max = brand.length >= 7 ? 2 : 1;
      if (token.length >= brand.length && levenshtein(token, brand, max) <= max) return "imitation";
    }
  }
  return null;
}

/** « Nitro gratuit » accompagné d'un lien non officiel : appât classique. */
export function isNitroBait(content: string, hosts: readonly string[]): boolean {
  if (!hosts.some((h) => !isSafeHost(h))) return false;
  const text = content.toLowerCase();
  return /nitro/.test(text) && /(free|gratuit|gift|cadeau|offert|giveaway|claim)/.test(text);
}

/** Lien désamorcé pour l'affichage dans une alerte (non cliquable). */
export function defang(url: string): string {
  return url.replace(/^http/i, "hxxp").replace(/\./g, "[.]");
}
