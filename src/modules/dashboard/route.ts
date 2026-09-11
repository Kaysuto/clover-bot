import { z } from "zod";
import {
  ChannelType,
  PermissionFlagsBits,
  type GuildMember,
  type Guild,
  type User,
  type TextChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { env } from "../../config";
import { db, pool } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botSanctions, botTickets, botGiveaways } from "../../db/schema";
import type { IngressRoute } from "../../lib/ingress";
import {
  fetchBalance,
  purchase,
  deposit,
  fetchCatalogue,
} from "../../lib/site-api";
import { applySanction, revokeSanction } from "../moderation/sanctions";
import { canManageTicket, closeTicket } from "../tickets/manager";
import {
  buildGiveawayEmbed,
  buildGiveawayButtons,
  claimGiveaway,
  endGiveaway,
} from "../giveaways/manager";
import {
  getLogSettings,
  setLogSetting,
  LOG_CATEGORY_KEYS,
  type LogCategory,
} from "../logs/channel";
import { MODULE_IDS, moduleEnabled } from "./modules";
import { configPatch, adminEnvelope, period, snowflake } from "./validation";
import { recordAudit } from "./statistics";
import { economyRequest } from "./economy-request";
import { targetRefusal } from "../moderation/target";
class Refusal extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function permitted(member: GuildMember, permission: bigint) {
  if (!member.permissions.has(permission))
    throw new Refusal(403, "Permission Discord insuffisante.");
}
async function targetGuard(guild: Guild, member: GuildMember, target: User) {
  const reason = await targetRefusal(guild, member, target);
  if (reason) throw new Refusal(403, reason);
}
async function requireModule(guildId: string, id: (typeof MODULE_IDS)[number]) {
  if (!(await moduleEnabled(guildId, id)))
    throw new Refusal(409, "Ce module est désactivé.");
}
export function createDashboardRoute(client: CloverClient): IngressRoute {
  return {
    path: "/admin",
    token: env.DASHBOARD_TOKEN,
    headerOnly: "x-dashboard-token",
    async handle({ payload }) {
      try {
        const envelope = adminEnvelope.parse(payload);
        const { operation, guildId, actorId } = envelope;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) throw new Refusal(404, "Serveur inaccessible.");
        const cfg = await getGuildConfig(guildId);
        const ok = (data: unknown) => ({ status: 200, message: "OK", data });
        const bounds = () =>
          period.parse(
            payload.period ?? {
              from: new Date(Date.now() - 30 * 86400000)
                .toISOString()
                .slice(0, 10),
              to: new Date().toISOString().slice(0, 10),
            },
          );
        if (operation === "snapshot") {
          const range = bounds();
          const history = await pool.query(
            `SELECT to_char(d,'YYYY-MM-DD') AS date,s.members FROM generate_series($2::date,$3::date,'1 day') d LEFT JOIN bot_dashboard_daily s ON s.guild_id=$1 AND s.day=to_char(d,'YYYY-MM-DD') ORDER BY d`,
            [guildId, range.from, range.to],
          );
          const counts = await pool.query(
            `SELECT SUM(messages)::int AS messages,MAX(observed_at) AS observed_at,MIN(created_at) AS started FROM bot_dashboard_daily WHERE guild_id=$1 AND day BETWEEN $2 AND $3`,
            [guildId, range.from, range.to],
          );
          const records = await pool.query(
            `SELECT (SELECT COUNT(*)::int FROM bot_tickets WHERE guild_id=$1 AND opened_at >= $2::date AT TIME ZONE 'Europe/Paris' AND opened_at < ($3::date+1) AT TIME ZONE 'Europe/Paris') AS tickets,(SELECT COUNT(*)::int FROM bot_sanctions WHERE guild_id=$1 AND created_at >= $2::date AT TIME ZONE 'Europe/Paris' AND created_at < ($3::date+1) AT TIME ZONE 'Europe/Paris') AS sanctions`,
            [guildId, range.from, range.to],
          );
          const recent = await pool.query(
            "SELECT id::text,action AS label,created_at AS at,actor_id AS actor FROM bot_dashboard_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 30",
            [guildId],
          );
          const available = Object.fromEntries(
            MODULE_IDS.map((id) => [id, !cfg.disabledModules.includes(id)]),
          );
          const safeConfig = Object.fromEntries(
            Object.keys(configPatch.shape).map((key) => [
              key,
              cfg[key as keyof typeof cfg],
            ]),
          );
          return ok({
            modules: available,
            config: safeConfig,
            logSettings: await getLogSettings(guildId),
            revision: String(cfg.configVersion),
            stats: {
              members: history.rows.at(-1)?.members ?? null,
              messages: counts.rows[0]?.messages ?? null,
              tickets: records.rows[0]?.tickets ?? 0,
              sanctions: records.rows[0]?.sanctions ?? 0,
              history: history.rows,
              observedAt: counts.rows[0]?.observed_at ?? null,
              collectionStartedAt: counts.rows[0]?.started ?? null,
            },
            activity: recent.rows.map((r) => ({ ...r, type: "config" })),
            channels: guild.channels.cache
              .filter(
                (c) =>
                  c.type === ChannelType.GuildText ||
                  c.type === ChannelType.GuildCategory,
              )
              .map((c) => ({ id: c.id, name: c.name, type: c.type })),
            roles: guild.roles.cache
              .filter((r) => !r.managed && r.id !== guild.id)
              .map((r) => ({ id: r.id, name: r.name })),
          });
        }
        const reads: Record<string, string> = {
          moderation:
            'SELECT id,user_id AS "userId",type,reason,active,created_at AS "createdAt" FROM bot_sanctions WHERE guild_id=$1 ORDER BY id DESC LIMIT 100',
          tickets: `SELECT id,ticket_number AS "ticketNumber",opener_id AS username,subject,CASE WHEN status='CLOSED' THEN 'closed' ELSE 'open' END AS status,opened_at AS "createdAt" FROM bot_tickets WHERE guild_id=$1 ORDER BY id DESC LIMIT 100`,
          levels:
            'SELECT user_id AS "userId",user_id AS username,level,xp FROM bot_levels WHERE guild_id=$1 ORDER BY xp DESC LIMIT 100',
          invites: `SELECT id,inviter_id AS inviter,member_id AS invitee,lower(reward_status) AS status,joined_at AS "joinedAt",joined_at + make_interval(days=>$2::int) AS "maturesAt" FROM bot_invite_joins WHERE guild_id=$1 ORDER BY id DESC LIMIT 100`,
          events: `SELECT id,prize AS title,prize,ends_at AS "endsAt",CASE WHEN ended THEN 'ended' ELSE 'active' END AS status FROM bot_giveaways WHERE guild_id=$1 ORDER BY id DESC LIMIT 100`,
          logs: 'SELECT id,action,actor_id AS actor,created_at AS "createdAt" FROM bot_dashboard_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 100',
        };
        if (reads[operation])
          return ok({
            rows: (
              await pool.query(
                reads[operation]!,
                operation === "invites"
                  ? [guildId, cfg.inviteMaturityDays]
                  : [guildId],
              )
            ).rows,
          });
        if (operation === "economy") {
          if (payload.userId) {
            const userId = snowflake.parse(payload.userId);
            if (!(await guild.members.fetch(userId).catch(() => null)))
              throw new Refusal(404, "Membre introuvable dans ce serveur.");
            const result = await fetchBalance(userId);
            if (!result.ok) throw new Refusal(502, result.error);
            return ok(result.data);
          }
          const result = await fetchCatalogue();
          if (!result.ok) throw new Refusal(502, result.error);
          return ok(result.data);
        }
        if (!actorId) throw new Refusal(403, "Acteur Discord requis.");
        const member = await guild.members.fetch(actorId).catch(() => null);
        if (!member)
          throw new Refusal(403, "L’acteur doit appartenir au serveur.");
        // Record the request before side effects. Details and secrets never enter the audit.
        const labels: Record<string, string> = {
          "config.write": "Modification des réglages",
          "module.write": "Activation de module",
          "moderation.write": "Action de modération",
          "tickets.write": "Fermeture de ticket",
          "logs.write": "Réglage des logs",
          "events.write": "Gestion de concours",
          "economy.write": "Opération économique",
        };
        await recordAudit(
          guildId,
          actorId,
          labels[operation] ?? "Demande administrative",
        );
        if (operation === "config.write") {
          permitted(member, PermissionFlagsBits.ManageGuild);
          const input = z
            .object({
              revision: z.string().regex(/^\d+$/),
              values: configPatch,
            })
            .parse(payload);
          const merged = { ...cfg, ...input.values };
          if (merged.xpMin > merged.xpMax)
            throw new Refusal(400, "L’XP minimale dépasse l’XP maximale.");
          for (const [key, id] of Object.entries(input.values)) {
            if (!key.endsWith("Id") || !id) continue;
            if (key.endsWith("RoleId")) {
              const role = await guild.roles.fetch(String(id));
              if (
                !role ||
                role.managed ||
                role.id === guild.id ||
                role.position >=
                  (await guild.members.fetchMe()).roles.highest.position
              )
                throw new Refusal(400, "Rôle inaccessible au bot.");
            } else {
              const channel = await guild.channels.fetch(String(id));
              if (!channel) throw new Refusal(400, "Salon introuvable.");
              if (key === "ticketCategoryId") {
                if (channel.type !== ChannelType.GuildCategory)
                  throw new Refusal(400, "Une catégorie est requise.");
              } else if (
                channel.type !== ChannelType.GuildText ||
                !channel
                  .permissionsFor(await guild.members.fetchMe())
                  ?.has([
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                  ])
              )
                throw new Refusal(
                  400,
                  "Le bot ne peut pas écrire dans ce salon.",
                );
            }
          }
          await updateGuildConfig(
            guildId,
            input.values,
            Number(input.revision),
          );
          return ok({ saved: true });
        }
        if (operation === "module.write") {
          permitted(member, PermissionFlagsBits.ManageGuild);
          const input = z
            .object({ id: z.enum(MODULE_IDS), enabled: z.boolean() })
            .parse(payload);
          const disabled = cfg.disabledModules.filter((id) => id !== input.id);
          if (!input.enabled) disabled.push(input.id);
          await updateGuildConfig(
            guildId,
            { disabledModules: disabled },
            cfg.configVersion,
          );
          return ok({ saved: true });
        }
        if (operation === "moderation.write") {
          const input = z
            .object({
              action: z.enum(["apply", "revoke"]),
              id: z.number().int().positive().optional(),
              userId: snowflake.optional(),
              type: z.enum(["warn", "timeout", "kick", "ban"]).optional(),
              reason: z.string().trim().min(1).max(500),
              durationSeconds: z
                .number()
                .int()
                .min(1)
                .max(28 * 86400)
                .optional(),
            })
            .parse(payload);
          if (input.action === "apply") {
            await requireModule(guildId, "moderation");
            if (!input.userId || !input.type)
              throw new Refusal(400, "Cible et sanction requises.");
            const permission =
              input.type === "ban"
                ? PermissionFlagsBits.BanMembers
                : input.type === "kick"
                  ? PermissionFlagsBits.KickMembers
                  : PermissionFlagsBits.ModerateMembers;
            permitted(member, permission);
            const me = await guild.members.fetchMe();
            permitted(me, permission);
            const target = await client.users.fetch(input.userId);
            await targetGuard(guild, member, target);
            if (input.type === "timeout" && !input.durationSeconds)
              throw new Refusal(
                400,
                "Durée requise pour l’exclusion temporaire.",
              );
            const types = {
              warn: "WARN",
              timeout: "MUTE",
              kick: "KICK",
              ban: "BAN",
            } as const;
            const result = await applySanction({
              guild,
              target,
              moderator: member.user,
              type: types[input.type],
              reason: input.reason,
              durationMs: input.durationSeconds
                ? input.durationSeconds * 1000
                : null,
            });
            return ok({ id: result.sanction.id, warnings: result.failures });
          }
          const [row] = await db
            .select()
            .from(botSanctions)
            .where(
              and(
                eq(botSanctions.guildId, guildId),
                eq(botSanctions.id, input.id ?? 0),
              ),
            )
            .limit(1);
          if (!row || !row.active)
            throw new Refusal(404, "Sanction active introuvable.");
          permitted(
            member,
            row.type === "BAN"
              ? PermissionFlagsBits.BanMembers
              : PermissionFlagsBits.ModerateMembers,
          );
          await targetGuard(
            guild,
            member,
            await client.users.fetch(row.userId),
          );
          const warnings = await revokeSanction(
            guild,
            row,
            actorId,
            input.reason,
          );
          return ok({ warnings });
        }
        if (operation === "tickets.write") {
          const input = z
            .object({
              action: z.literal("close"),
              id: z.number().int().positive(),
              reason: z.string().trim().min(1).max(500),
            })
            .parse(payload);
          const [row] = await db
            .select()
            .from(botTickets)
            .where(
              and(eq(botTickets.id, input.id), eq(botTickets.guildId, guildId)),
            )
            .limit(1);
          if (!row || row.status === "CLOSED")
            throw new Refusal(404, "Ticket ouvert introuvable.");
          if (!canManageTicket(member, cfg, row))
            throw new Refusal(403, "Droits de gestion du ticket requis.");
          const channel = await guild.channels.fetch(row.channelId);
          if (channel?.type !== ChannelType.GuildText)
            throw new Refusal(404, "Salon du ticket introuvable.");
          const result = await closeTicket(
            client,
            channel as TextChannel,
            row,
            actorId,
            input.reason,
          );
          if (!result.ok) throw new Refusal(409, result.error);
          return ok({ closed: true });
        }
        if (operation === "logs.write") {
          permitted(member, PermissionFlagsBits.ManageGuild);
          const input = z
            .object({
              category: z.enum(
                LOG_CATEGORY_KEYS as [LogCategory, ...LogCategory[]],
              ),
              enabled: z.boolean(),
              channelId: snowflake.nullable().optional(),
            })
            .parse(payload);
          if (input.channelId) {
            const channel = await guild.channels.fetch(input.channelId);
            if (
              channel?.type !== ChannelType.GuildText ||
              !channel
                .permissionsFor(await guild.members.fetchMe())
                ?.has([
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                ])
            )
              throw new Refusal(400, "Salon inaccessible.");
          }
          await setLogSetting(guildId, input.category, {
            enabled: input.enabled,
            channelId: input.channelId,
          });
          return ok(await getLogSettings(guildId));
        }
        if (operation === "events.write") {
          permitted(member, PermissionFlagsBits.ManageGuild);
          if (payload.action === "end") {
            const id = z.number().int().positive().parse(payload.id);
            const [row] = await db
              .select()
              .from(botGiveaways)
              .where(
                and(eq(botGiveaways.id, id), eq(botGiveaways.guildId, guildId)),
              )
              .limit(1);
            if (!row || !(await claimGiveaway(id)))
              throw new Refusal(409, "Concours déjà terminé ou introuvable.");
            await endGiveaway(client, row);
            return ok({ ended: true });
          }
          await requireModule(guildId, "events");
          const input = z
            .object({
              action: z.literal("create"),
              title: z.string().trim().min(1).max(100),
              prize: z.string().trim().min(1).max(250),
              channelId: snowflake,
              endsAt: z.iso.datetime(),
              winners: z.number().int().min(1).max(20),
            })
            .parse(payload);
          const endsAt = new Date(input.endsAt);
          if (+endsAt <= Date.now() || +endsAt > Date.now() + 90 * 86400000)
            throw new Refusal(
              400,
              "La fin doit être dans les 90 prochains jours.",
            );
          const channel = await guild.channels.fetch(input.channelId);
          if (
            channel?.type !== ChannelType.GuildText ||
            !channel
              .permissionsFor(await guild.members.fetchMe())
              ?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
              ])
          )
            throw new Refusal(400, "Salon inaccessible au bot.");
          const [row] = await db
            .insert(botGiveaways)
            .values({
              guildId,
              channelId: channel.id,
              prize: input.title + " — " + input.prize,
              hostId: actorId,
              winnersCount: input.winners,
              endsAt,
            })
            .returning();
          if (!row) throw new Refusal(500, "Création impossible.");
          try {
            const msg = await channel.send({
              embeds: [buildGiveawayEmbed(row, 0)],
              components: [buildGiveawayButtons(row.id)],
            });
            await db
              .update(botGiveaways)
              .set({ messageId: msg.id })
              .where(eq(botGiveaways.id, row.id));
          } catch (e) {
            await db
              .update(botGiveaways)
              .set({ ended: true })
              .where(eq(botGiveaways.id, row.id));
            throw e;
          }
          return ok({ id: row.id });
        }
        if (operation === "economy.write") {
          permitted(member, PermissionFlagsBits.ManageGuild);
          await requireModule(guildId, "economy");
          const input = z
            .discriminatedUnion("action", [
              z.object({
                action: z.literal("deposit"),
                userId: snowflake,
                credits: z.number().int().min(1).max(10000),
                reason: z.string().trim().min(1).max(200),
                idempotencyKey: z.string().uuid(),
              }),
              z.object({
                action: z.literal("purchase"),
                userId: snowflake,
                itemId: z.string().min(1).max(100),
                idempotencyKey: z.string().uuid(),
              }),
            ])
            .parse(payload);
          const targetMember = await guild.members
            .fetch(input.userId)
            .catch(() => null);
          if (!targetMember)
            throw new Refusal(400, "Le membre doit appartenir au serveur.");
          const result = await economyRequest(guildId, input);
          if (!result.ok) throw new Refusal(502, result.error);
          return ok(result.data);
        }
        throw new Refusal(404, "Opération inconnue.");
      } catch (e) {
        if (e instanceof z.ZodError)
          return { status: 400, message: "Paramètres invalides." };
        if (e instanceof Refusal)
          return { status: e.status, message: e.message };
        if (e instanceof Error && e.message === "CONFIG_CONFLICT")
          return { status: 409, message: "La configuration a changé." };
        return { status: 500, message: "L’opération n’a pas abouti." };
      }
    },
  };
}
