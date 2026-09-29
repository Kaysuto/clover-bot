import type { Message } from "discord.js";
import { env } from "../../config";
import type { GuildConfig } from "../../db/guild-config";
import { logger } from "../../lib/logger";
import { moduleEnabled } from "../dashboard/modules";
import { deleteWebhookOf } from "./antiwebhook";
import { recordIncident } from "./incidents";
import { classifyHost, defang, extractUrls, hostOf, isNitroBait } from "./phishing-detect";
import { deleteQuietly, timeoutMember } from "./sanctions";

/**
 * Anti-phishing : faux Nitro, vol de compte, domaines imités. Le message est
 * supprimé dès sa réception ; aucune exemption de staff, un compte de staff
 * volé étant justement le vecteur le plus courant.
 */

/** Filet si la liste publique est injoignable au démarrage. */
const FALLBACK_DOMAINS = [
  "discord-nitro.gift",
  "discordnitro.gift",
  "dlscord.gift",
  "discorcl.gift",
  "steamcommunlty.com",
  "stearncommunity.com",
];

let blocklist: ReadonlySet<string> = new Set(FALLBACK_DOMAINS);

/** Job (6 h, et au démarrage) : recharge la liste publique en mémoire. */
export async function refreshPhishingList(): Promise<void> {
  const res = await fetch(env.PHISHING_FEED_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  const domains = Array.isArray(body)
    ? body
    : ((body as { domains?: unknown }).domains ?? []);
  if (!Array.isArray(domains) || domains.length < 100) throw new Error("Liste vide ou illisible");
  blocklist = new Set([
    ...FALLBACK_DOMAINS,
    ...domains.filter((d): d is string => typeof d === "string").map((d) => d.toLowerCase()),
  ]);
  logger.info({ count: blocklist.size }, "Liste anti-phishing rechargée");
}

/** Textes où chercher des liens : contenu et embeds (titre, URL, description). */
function messageTexts(message: Message): string {
  const parts = [message.content];
  for (const embed of message.embeds) {
    parts.push(embed.url ?? "", embed.title ?? "", embed.description ?? "");
  }
  return parts.join("\n");
}

/** Retourne vrai si le message a été supprimé. */
export async function checkPhishing(message: Message<true>, cfg: GuildConfig): Promise<boolean> {
  if (!(await moduleEnabled(message.guildId, "antiphishing"))) return false;
  const urls = extractUrls(messageTexts(message));
  if (!urls.length) return false;

  const hosts = urls.map(hostOf).filter((h): h is string => h !== null);
  let hit: { url: string; why: string } | null = null;
  for (let i = 0; i < urls.length && !hit; i++) {
    const host = hostOf(urls[i]!);
    const verdict = host ? classifyHost(host, blocklist, cfg.phishingAllowDomains) : null;
    if (verdict) hit = { url: urls[i]!, why: verdict === "liste" ? "domaine d'hameçonnage connu" : "imitation d'un domaine officiel" };
  }
  if (!hit && isNitroBait(message.content, hosts)) {
    hit = { url: urls[0]!, why: "appât « Nitro gratuit »" };
  }
  if (!hit) return false;

  await deleteQuietly(message);
  const measures = ["Message supprimé"];
  let restore;
  if (message.webhookId) {
    measures.push((await deleteWebhookOf(message)) ? "Webhook supprimé" : "⚠️ Webhook non supprimé");
  } else if (message.member && message.author.id !== message.guild.ownerId) {
    const minutes = await timeoutMember(
      message.member,
      cfg.phishingTimeoutMinutes,
      "Anti-phishing : lien d'hameçonnage (compte peut-être volé)",
    );
    measures.push(minutes ? `Exclu ${minutes} min` : "⚠️ Exclusion impossible (hiérarchie)");
    if (minutes) restore = { timeouts: [message.author.id] };
  }

  await recordIncident(message.guild, {
    type: "phishing",
    actorId: message.author.id,
    targetId: message.author.id,
    summary: `Lien bloqué dans ${message.channel} (${hit.why}) : \`${defang(hit.url).slice(0, 200)}\`\nLe compte a peut-être été volé : le prévenir par un autre moyen.`,
    measures,
    restore,
  });
  return true;
}
