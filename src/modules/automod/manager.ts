import {
  type AutoModerationRule,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  type AutoModerationTriggerMetadataOptions,
  DiscordAPIError,
  type Guild,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { botAutomodRules } from "../../db/schema";
import { logger } from "../../lib/logger";

/**
 * Règles AutoMod natives de Discord, pilotées depuis `/config automod`.
 *
 * Le filtrage se fait côté Discord : le bot n'a donc pas besoin de l'intent
 * MessageContent pour bloquer un message, seulement de la permission « Gérer
 * le serveur ». Les déclenchements arrivent ensuite par l'événement
 * `autoModerationActionExecution` (cf. `modules/logs/automod.ts`).
 */

/** Types de règles gérés (clé technique → libellé affiché). */
export const AUTOMOD_KINDS = {
  spam: "Spam et contenu publicitaire",
  grossierete: "Grossièretés (listes Discord)",
  mentions: "Mentions massives",
  mots: "Mots interdits",
  invitations: "Liens d'invitation Discord",
} as const;

export type AutomodKind = keyof typeof AUTOMOD_KINDS;

export const AUTOMOD_KIND_KEYS = Object.keys(AUTOMOD_KINDS) as AutomodKind[];

/** Nom de la règle chez Discord ; le préfixe signale qu'elle est gérée par le bot. */
const RULE_NAMES: Record<AutomodKind, string> = {
  spam: "Clover • Spam",
  grossierete: "Clover • Grossièretés",
  mentions: "Clover • Mentions massives",
  mots: "Clover • Mots interdits",
  invitations: "Clover • Invitations Discord",
};

/** Motifs d'invitation Discord (syntaxe regex Rust, seule acceptée par AutoMod). */
const INVITE_PATTERNS = [
  "discord\\.gg/[a-zA-Z0-9-]+",
  "discord(app)?\\.com/invite/[a-zA-Z0-9-]+",
  "dsc\\.gg/[a-zA-Z0-9-]+",
  "invite\\.gg/[a-zA-Z0-9-]+",
];

const BLOCK_MESSAGE = "Message bloqué par la modération automatique de Clover Games.";

const EDIT_REASON = "Modification via /config automod";

export interface AutomodRuleState {
  kind: AutomodKind;
  /** La règle existe chez Discord et n'est pas désactivée. */
  enabled: boolean;
  /** Résumé du réglage (seuil, nombre de mots…), `null` si la règle n'existe pas. */
  detail: string | null;
  exemptRoleIds: string[];
  exemptChannelIds: string[];
}

async function readRuleId(guildId: string, kind: AutomodKind): Promise<string | null> {
  const [row] = await db
    .select({ ruleId: botAutomodRules.ruleId })
    .from(botAutomodRules)
    .where(and(eq(botAutomodRules.guildId, guildId), eq(botAutomodRules.kind, kind)));
  return row?.ruleId ?? null;
}

async function rememberRule(guildId: string, kind: AutomodKind, ruleId: string): Promise<void> {
  await db
    .insert(botAutomodRules)
    .values({ guildId, kind, ruleId })
    .onConflictDoUpdate({
      target: [botAutomodRules.guildId, botAutomodRules.kind],
      set: { ruleId },
    });
}

async function forgetRule(guildId: string, kind: AutomodKind): Promise<void> {
  await db
    .delete(botAutomodRules)
    .where(and(eq(botAutomodRules.guildId, guildId), eq(botAutomodRules.kind, kind)));
}

/**
 * Règle enregistrée pour ce type, ou `null` si elle a été supprimée depuis les
 * Paramètres du serveur : la référence morte est alors oubliée.
 */
async function fetchManagedRule(
  guild: Guild,
  kind: AutomodKind,
): Promise<AutoModerationRule | null> {
  const ruleId = await readRuleId(guild.id, kind);
  if (!ruleId) return null;
  try {
    return await guild.autoModerationRules.fetch(ruleId);
  } catch (err) {
    if (err instanceof DiscordAPIError && err.status === 404) {
      await forgetRule(guild.id, kind);
      return null;
    }
    throw err;
  }
}

/**
 * Exemptions à reprendre sur une règle créée après coup : elles sont stockées
 * par Discord sur chaque règle, pas en base, donc une nouvelle règle hérite de
 * celles déjà posées sur les autres règles du bot.
 */
async function inheritedExemptions(
  guild: Guild,
): Promise<{ roleIds: string[]; channelIds: string[] }> {
  const roleIds = new Set<string>();
  const channelIds = new Set<string>();
  for (const kind of AUTOMOD_KIND_KEYS) {
    const rule = await fetchManagedRule(guild, kind);
    if (!rule) continue;
    for (const role of rule.exemptRoles.values()) roleIds.add(role.id);
    for (const channel of rule.exemptChannels.values()) channelIds.add(channel.id);
  }
  return { roleIds: [...roleIds], channelIds: [...channelIds] };
}

async function upsertRule(
  guild: Guild,
  kind: AutomodKind,
  triggerType: AutoModerationRuleTriggerType,
  triggerMetadata: AutoModerationTriggerMetadataOptions,
): Promise<void> {
  const existing = await fetchManagedRule(guild, kind);
  if (existing) {
    await existing.edit({ triggerMetadata, enabled: true, reason: EDIT_REASON });
    return;
  }

  const exemptions = await inheritedExemptions(guild);
  const rule = await guild.autoModerationRules.create({
    name: RULE_NAMES[kind],
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType,
    triggerMetadata,
    actions: [
      {
        type: AutoModerationActionType.BlockMessage,
        metadata: { customMessage: BLOCK_MESSAGE },
      },
    ],
    enabled: true,
    exemptRoles: exemptions.roleIds,
    exemptChannels: exemptions.channelIds,
    reason: "Création via /config automod",
  });
  await rememberRule(guild.id, kind, rule.id);
  logger.info({ guildId: guild.id, kind, ruleId: rule.id }, "Règle AutoMod créée");
}

/** Supprime la règle chez Discord ; sans effet si elle n'existe pas. */
export async function removeRule(guild: Guild, kind: AutomodKind): Promise<void> {
  const rule = await fetchManagedRule(guild, kind);
  if (!rule) return;
  await rule.delete("Désactivation via /config automod");
  await forgetRule(guild.id, kind);
  logger.info({ guildId: guild.id, kind }, "Règle AutoMod supprimée");
}

/** Détection native du spam et des contenus publicitaires. */
export async function setSpamRule(guild: Guild, enabled: boolean): Promise<void> {
  if (!enabled) return removeRule(guild, "spam");
  await upsertRule(guild, "spam", AutoModerationRuleTriggerType.Spam, {});
}

/** Listes de grossièretés maintenues par Discord (profanité, sexuel, insultes). */
export async function setProfanityRule(guild: Guild, enabled: boolean): Promise<void> {
  if (!enabled) return removeRule(guild, "grossierete");
  await upsertRule(guild, "grossierete", AutoModerationRuleTriggerType.KeywordPreset, {
    presets: [
      AutoModerationRuleKeywordPresetType.Profanity,
      AutoModerationRuleKeywordPresetType.SexualContent,
      AutoModerationRuleKeywordPresetType.Slurs,
    ],
  });
}

/** Plafond de mentions par message ; `0` retire la règle. */
export async function setMentionRule(guild: Guild, limit: number): Promise<void> {
  if (limit <= 0) return removeRule(guild, "mentions");
  await upsertRule(guild, "mentions", AutoModerationRuleTriggerType.MentionSpam, {
    mentionTotalLimit: limit,
    mentionRaidProtectionEnabled: true,
  });
}

/** Liste de mots interdits ; une liste vide retire la règle. */
export async function setKeywordRule(guild: Guild, keywords: string[]): Promise<void> {
  if (keywords.length === 0) return removeRule(guild, "mots");
  await upsertRule(guild, "mots", AutoModerationRuleTriggerType.Keyword, {
    keywordFilter: keywords,
  });
}

/** Blocage des liens d'invitation vers d'autres serveurs Discord. */
export async function setInviteRule(guild: Guild, enabled: boolean): Promise<void> {
  if (!enabled) return removeRule(guild, "invitations");
  await upsertRule(guild, "invitations", AutoModerationRuleTriggerType.Keyword, {
    regexPatterns: INVITE_PATTERNS,
  });
}

/**
 * Applique une exemption (rôle ou salon) à toutes les règles gérées : le staff
 * doit pouvoir citer un lien ou un mot filtré sans être bloqué.
 */
export async function setExemption(
  guild: Guild,
  target: { roleId?: string; channelId?: string },
  remove: boolean,
): Promise<number> {
  let touched = 0;
  for (const kind of AUTOMOD_KIND_KEYS) {
    const rule = await fetchManagedRule(guild, kind);
    if (!rule) continue;

    const roleIds = new Set(rule.exemptRoles.map((role) => role.id));
    const channelIds = new Set(rule.exemptChannels.map((channel) => channel.id));
    if (target.roleId) {
      if (remove) roleIds.delete(target.roleId);
      else roleIds.add(target.roleId);
    }
    if (target.channelId) {
      if (remove) channelIds.delete(target.channelId);
      else channelIds.add(target.channelId);
    }

    await rule.edit({
      exemptRoles: [...roleIds],
      exemptChannels: [...channelIds],
      reason: EDIT_REASON,
    });
    touched += 1;
  }
  return touched;
}

/** Résumé lisible du contenu d'une règle, pour `/config automod voir`. */
function describeRule(kind: AutomodKind, rule: AutoModerationRule): string {
  switch (kind) {
    case "mentions": {
      const limit = rule.triggerMetadata.mentionTotalLimit;
      return limit ? `${limit} mentions maximum par message` : "seuil non défini";
    }
    case "mots": {
      const count = rule.triggerMetadata.keywordFilter.length;
      return `${count} mot${count > 1 ? "s" : ""} filtré${count > 1 ? "s" : ""}`;
    }
    case "invitations":
      return `${rule.triggerMetadata.regexPatterns.length} motifs d'invitation`;
    case "grossierete":
      return "listes Discord : profanité, sexuel, insultes";
    case "spam":
      return "détection native du spam";
  }
}

/** État des cinq règles gérées, dans l'ordre d'affichage. */
export async function getAutomodState(guild: Guild): Promise<AutomodRuleState[]> {
  const states: AutomodRuleState[] = [];
  for (const kind of AUTOMOD_KIND_KEYS) {
    const rule = await fetchManagedRule(guild, kind);
    states.push({
      kind,
      enabled: rule?.enabled ?? false,
      detail: rule ? describeRule(kind, rule) : null,
      exemptRoleIds: rule ? rule.exemptRoles.map((role) => role.id) : [],
      exemptChannelIds: rule ? rule.exemptChannels.map((channel) => channel.id) : [],
    });
  }
  return states;
}
