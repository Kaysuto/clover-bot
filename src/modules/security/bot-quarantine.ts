import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
  type GuildMember,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botBotQuarantine } from "../../db/schema";
import { buildId } from "../../lib/ids";
import { moduleEnabled } from "../dashboard/modules";
import { findAuditEntry } from "../logs/audit";
import { recordIncident } from "./incidents";
import { isDangerousRole } from "./permissions";
import { isTrusted } from "./trust";

/**
 * Quarantaine des bots : un bot qui arrive voit les permissions de son rôle
 * d'intégration ramenées à zéro jusqu'à la décision du propriétaire. Le rôle
 * d'intégration ne peut pas être retiré, seulement vidé — d'où la
 * mémorisation de ses permissions d'origine.
 */

export type QuarantinedBot = typeof botBotQuarantine.$inferSelect;

function integrationRole(guild: Guild, botId: string) {
  return guild.roles.cache.find((role) => role.tags?.botId === botId) ?? null;
}

/**
 * Vide les permissions du bot (rôle d'intégration à zéro, rôles sensibles
 * retirés) et le place en attente. Si le bot est déjà en attente, ses
 * permissions d'origine déjà mémorisées sont conservées. Retourne faux si le
 * bot est hors d'atteinte (rôle au-dessus du mien).
 */
export async function neutralizeBot(
  bot: GuildMember,
  addedBy: string | null,
  reason: string,
): Promise<boolean> {
  const guild = bot.guild;
  await guild.roles.fetch();
  const role = integrationRole(guild, bot.id);
  const me = await guild.members.fetchMe();
  if (role && role.position >= me.roles.highest.position) return false;

  const [existing] = await db
    .select()
    .from(botBotQuarantine)
    .where(and(eq(botBotQuarantine.guildId, guild.id), eq(botBotQuarantine.botId, bot.id)));
  const keepOriginal = existing?.status === "pending";
  const original = keepOriginal ? existing.permissions : (role?.permissions.bitfield ?? 0n).toString();

  await db
    .insert(botBotQuarantine)
    .values({ guildId: guild.id, botId: bot.id, roleId: role?.id ?? null, permissions: original, addedBy })
    .onConflictDoUpdate({
      target: [botBotQuarantine.guildId, botBotQuarantine.botId],
      set: { roleId: role?.id ?? null, permissions: original, status: "pending", decidedBy: null },
    });

  if (role && role.permissions.bitfield !== 0n) {
    const ok = await role
      .setPermissions(0n, reason)
      .then(() => true)
      .catch(() => false);
    if (!ok) return false;
  }
  const dangerous = bot.roles.cache.filter((r) => !r.managed && r.id !== guild.id && isDangerousRole(r));
  if (dangerous.size) await bot.roles.remove([...dangerous.keys()], reason).catch(() => undefined);
  return true;
}

function decisionRow(botId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("secu", "bot-ok", botId))
      .setLabel("Autoriser")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildId("secu", "bot-kick", botId))
      .setLabel("Expulser")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Auteur de l'ajout d'un bot. L'attente couvre aussi la création du rôle
 * d'intégration, publiée juste après l'arrivée.
 */
export async function findBotAdder(bot: GuildMember): Promise<string | null> {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const entry = await findAuditEntry(bot.guild, AuditLogEvent.BotAdd, bot.id, { delayMs: 0 });
  return entry?.executorId ?? null;
}

/** Arrivée d'un bot : quarantaine, sauf bot déjà de confiance. */
export async function onBotJoin(bot: GuildMember, addedBy: string | null): Promise<void> {
  const guild = bot.guild;
  if (!bot.user.bot || bot.id === guild.client.user.id) return;
  if (!(await moduleEnabled(guild.id, "quarantaine"))) return;
  if (await isTrusted(guild, bot.id)) return;

  const ok = await neutralizeBot(bot, addedBy, "Quarantaine : nouveau bot en attente d'autorisation");

  await recordIncident(guild, {
    type: "bot-quarantine",
    actorId: addedBy,
    targetId: bot.id,
    summary: `${bot} (\`${bot.user.username}\`) a été ajouté par ${addedBy ? `<@${addedBy}>` : "un auteur inconnu"}.`,
    measures: [
      ok
        ? "Permissions à zéro jusqu'à autorisation du propriétaire ou du rôle de sécurité"
        : "⚠️ Rôle du bot au-dessus du mien : quarantaine impossible",
    ],
    actions: ok ? [decisionRow(bot.id)] : undefined,
    shareWithNetwork: false,
  });

  const owner = await guild.fetchOwner().catch(() => null);
  await owner
    ?.send(
      `🛡️ Le bot **${bot.user.username}** vient d'être ajouté à **${guild.name}** ${ok ? "et attend ton autorisation" : "mais n'a pas pu être mis en quarantaine"}. Décision dans le salon d'alerte sécurité, ou \`/securite bot autoriser\`.`,
    )
    .catch(() => undefined);
}

/** Rend au bot ses permissions d'origine. */
export async function approveBot(guild: Guild, botId: string, by: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(botBotQuarantine)
    .where(and(eq(botBotQuarantine.guildId, guild.id), eq(botBotQuarantine.botId, botId)));
  if (!row || row.status !== "pending") return "Ce bot n'est pas en attente.";
  const member = await guild.members.fetch(botId).catch(() => null);
  if (!member) return "Ce bot n'est plus sur le serveur.";

  await guild.roles.fetch();
  const role = integrationRole(guild, botId);
  if (role) {
    const ok = await role
      .setPermissions(BigInt(row.permissions), `Bot autorisé par ${by}`)
      .then(() => true)
      .catch(() => false);
    if (!ok) return "Impossible de rendre les permissions (rôle au-dessus du mien ?).";
  }
  const { verifyRoleId } = await getGuildConfig(guild.id);
  if (verifyRoleId) await member.roles.add(verifyRoleId).catch(() => undefined);

  await db
    .update(botBotQuarantine)
    .set({ status: "approved", decidedBy: by })
    .where(and(eq(botBotQuarantine.guildId, guild.id), eq(botBotQuarantine.botId, botId)));
  return null;
}

export async function kickQuarantinedBot(guild: Guild, botId: string, by: string): Promise<string | null> {
  // Seul un bot en attente peut être expulsé par cette voie : sans ce contrôle,
  // elle permettrait d'expulser n'importe quel membre, même mieux placé.
  const [row] = await db
    .select()
    .from(botBotQuarantine)
    .where(and(eq(botBotQuarantine.guildId, guild.id), eq(botBotQuarantine.botId, botId)));
  if (!row || row.status !== "pending") return "Ce bot n'est pas en attente.";
  const member = await guild.members.fetch(botId).catch(() => null);
  if (member && !member.user.bot) return "Ce compte n'est pas un bot.";
  if (member) {
    const ok = await member
      .kick(`Bot refusé par ${by}`)
      .then(() => true)
      .catch(() => false);
    if (!ok) return "Expulsion impossible.";
  }
  await db
    .update(botBotQuarantine)
    .set({ status: "kicked", decidedBy: by })
    .where(and(eq(botBotQuarantine.guildId, guild.id), eq(botBotQuarantine.botId, botId)));
  return null;
}

export async function pendingBots(guildId: string): Promise<QuarantinedBot[]> {
  return db
    .select()
    .from(botBotQuarantine)
    .where(and(eq(botBotQuarantine.guildId, guildId), eq(botBotQuarantine.status, "pending")));
}
