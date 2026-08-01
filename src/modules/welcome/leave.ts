import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  ModalBuilder,
  type PartialGuildMember,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botLeaveFeedback } from "../../db/schema";
import { formatDuration } from "../../lib/duration";
import { brandEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import type { DmComponentHandler } from "../../types";
import { findAuditEntry } from "../logs/audit";
import { LOG_COLOR, logEmbed, trim } from "../logs/format";

export type LeaveFeedbackRow = typeof botLeaveFeedback.$inferSelect;

/** Préfixe de customId routé vers ce module (voir src/components.ts). */
const PREFIX = "depart";

interface LeaveReason {
  emoji: string;
  label: string;
  /** Description sous l'option du menu déroulant (100 caractères max). */
  hint: string;
}

/**
 * Raisons proposées. Une liste fermée vaut mieux qu'un champ libre : elle
 * s'agrège (voir `getLeaveFeedbackStats`) et se répond en un clic, donc bien
 * plus de monde répond. Le champ libre reste en option juste après.
 */
export const LEAVE_REASONS: Record<string, LeaveReason> = {
  temps: {
    emoji: "⏳",
    label: "Je n'ai plus le temps de jouer",
    hint: "Études, travail, moins de temps libre",
  },
  contenu: {
    emoji: "🎮",
    label: "Les modes de jeu ne me plaisent plus",
    hint: "Manque de contenu, de nouveautés, lassitude",
  },
  joueurs: {
    emoji: "🫥",
    label: "Pas assez de joueurs en ligne",
    hint: "Serveurs vides aux heures où je joue",
  },
  ambiance: {
    emoji: "💬",
    label: "L'ambiance ou la communauté",
    hint: "Toxicité, conflits, mauvaise expérience",
  },
  staff: {
    emoji: "🛡️",
    label: "Un problème avec le staff ou une sanction",
    hint: "Modération, sanction, demande sans réponse",
  },
  technique: {
    emoji: "🐛",
    label: "Trop de bugs, de lag ou de crashs",
    hint: "Problèmes techniques ou de performance",
  },
  boutique: {
    emoji: "🛒",
    label: "La boutique ou le pay-to-win",
    hint: "Prix, avantages payants, achat non reçu",
  },
  discord: {
    emoji: "🔔",
    label: "Trop de messages sur le Discord",
    hint: "Serveur Discord trop bruyant",
  },
  autre: {
    emoji: "❓",
    label: "Autre raison",
    hint: "Je précise à l'étape suivante",
  },
};

export const LEAVE_REASON_KEYS = Object.keys(LEAVE_REASONS);

function reasonLabel(key: string | null): string {
  const reason = key ? LEAVE_REASONS[key] : undefined;
  return reason ? `${reason.emoji} ${reason.label}` : "*non précisée*";
}

// ─── Envoi du sondage ────────────────────────────────────────────────────────

/**
 * MP de départ : « qu'est-ce qui t'a fait partir ? ».
 *
 * Une ligne est créée même quand le MP n'arrive pas (`UNREACHABLE`) : sans ça,
 * les statistiques ne porteraient que sur les membres joignables et
 * surestimeraient la représentativité des réponses.
 *
 * Discord n'autorise un MP que vers un utilisateur avec qui le bot partage un
 * serveur : au départ, ce n'est plus le cas. L'envoi réussit en pratique quand
 * une conversation privée existe déjà (typiquement le MP de bienvenue), et
 * échoue sinon — d'où l'échec silencieux et le décompte `UNREACHABLE`.
 */
export async function sendLeaveSurvey(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;

  const guild = member.guild;
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.leaveSurveyEnabled) return;

  // Un membre banni ou expulsé n'a pas choisi de partir : lui demander pourquoi
  // serait déplacé, et sa réponse fausserait les statistiques.
  const ban = await findAuditEntry(guild, AuditLogEvent.MemberBanAdd, member.id, {
    maxAgeMs: 10_000,
  });
  if (ban) return;
  const kick = await findAuditEntry(guild, AuditLogEvent.MemberKick, member.id, {
    maxAgeMs: 10_000,
    delayMs: 0, // l'attente a déjà eu lieu pour la recherche de bannissement
  });
  if (kick) return;

  const [row] = await db
    .insert(botLeaveFeedback)
    .values({
      guildId: guild.id,
      userId: member.id,
      username: member.user.username,
      membershipMs: member.joinedAt
        ? Date.now() - member.joinedAt.getTime()
        : null,
    })
    .returning();
  if (!row) return;

  try {
    await member.user.send(buildSurveyDm(guild, row.id));
  } catch (err) {
    await db
      .update(botLeaveFeedback)
      .set({ status: "UNREACHABLE" })
      .where(eq(botLeaveFeedback.id, row.id));
    logger.debug(
      { err, userId: member.id },
      "Sondage de départ non remis (MP fermés ou plus de serveur commun)",
    );
  }
}

export function surveyEmbed(guild: Guild): EmbedBuilder {
  return brandEmbed()
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle("👋 Tu viens de quitter le serveur")
    .setDescription(
      [
        `Merci d'être passé sur **${guild.name}** — la porte reste ouverte si tu veux revenir.`,
        "",
        "Une dernière chose, si tu as cinq secondes : **qu'est-ce qui t'a fait partir ?**",
        "Ta réponse sert uniquement à améliorer le serveur, et seule l'équipe la lit.",
      ].join("\n"),
    )
    .setFooter({
      text: "Réponse facultative • Tu peux simplement ignorer ce message",
    });
}

function buildSurveyDm(guild: Guild, id: number) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId(PREFIX, "raison", id))
    .setPlaceholder("Choisis la raison la plus proche…")
    .addOptions(
      Object.entries(LEAVE_REASONS).map(([value, reason]) => ({
        value,
        label: reason.label,
        description: reason.hint,
        emoji: reason.emoji,
      })),
    );

  const decline = new ButtonBuilder()
    .setCustomId(buildId(PREFIX, "refus", id))
    .setLabel("Je préfère ne pas répondre")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [surveyEmbed(guild)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(decline),
    ],
  };
}

// ─── Réponses (interactions reçues en message privé) ─────────────────────────

export const handleLeaveComponent: DmComponentHandler = async (
  interaction,
  action,
  args,
  client,
) => {
  const id = Number(args[0]);
  if (!Number.isInteger(id)) return;

  const [row] = await db
    .select()
    .from(botLeaveFeedback)
    .where(eq(botLeaveFeedback.id, id))
    .limit(1);
  // Le sondage est privé, mais un customId ne se vérifie jamais tout seul.
  if (!row || row.userId !== interaction.user.id) return;

  switch (action) {
    case "raison": {
      if (!interaction.isStringSelectMenu()) return;
      const reason = interaction.values[0] ?? "autre";
      const [answered] =
        row.status === "SENT"
          ? await db
              .update(botLeaveFeedback)
              .set({ reason, status: "ANSWERED", answeredAt: new Date() })
              .where(eq(botLeaveFeedback.id, id))
              .returning()
          : [];
      // Réponse à l'interaction avant la publication côté staff : Discord n'en
      // attend pas plus de 3 s, et cette publication est un appel réseau.
      await interaction.update(buildThanksDm(id, reason));
      if (answered) await publishFeedback(client, answered);
      return;
    }

    case "detail": {
      if (!interaction.isButton()) return;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(buildId(PREFIX, "commentaire", id))
          .setTitle("Ce qui pourrait être amélioré")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("comment")
                .setLabel("En quelques mots (facultatif)")
                .setPlaceholder(
                  "Ce qui t'a déplu, ce qui te ferait revenir…",
                )
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(1000),
            ),
          ),
      );
      return;
    }

    case "commentaire": {
      if (!interaction.isModalSubmit()) return;
      const comment = interaction.fields.getTextInputValue("comment").trim();
      const [updated] = comment
        ? await db
            .update(botLeaveFeedback)
            .set({ comment })
            .where(eq(botLeaveFeedback.id, id))
            .returning()
        : [];
      const done = {
        embeds: [
          brandEmbed().setDescription(
            comment
              ? "🍀 C'est transmis à l'équipe. Merci d'avoir pris le temps — bon vent !"
              : "🍀 Merci pour ton retour, il est bien enregistré.",
          ),
        ],
        components: [],
      };
      // La modale a été ouverte depuis un message : on peut le remplacer.
      if (interaction.isFromMessage()) await interaction.update(done);
      else await interaction.reply(done);
      if (updated) await publishFeedback(client, updated);
      return;
    }

    case "refus": {
      if (!interaction.isButton()) return;
      if (row.status === "SENT") {
        await db
          .update(botLeaveFeedback)
          .set({ status: "DECLINED", answeredAt: new Date() })
          .where(eq(botLeaveFeedback.id, id));
      }
      await interaction.update({
        embeds: [
          brandEmbed().setDescription(
            "Pas de souci, merci quand même 🍀 Tu es le bienvenu si tu veux revenir.",
          ),
        ],
        components: [],
      });
      return;
    }
  }
};

function buildThanksDm(id: number, reason: string) {
  const embed = brandEmbed()
    .setTitle("🍀 Merci pour ton retour")
    .setDescription(
      [
        `Réponse enregistrée : **${reasonLabel(reason)}**`,
        "",
        "Si tu veux préciser en quelques mots, c'est ce qui nous aide le plus à corriger le tir.",
      ].join("\n"),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(PREFIX, "detail", id))
          .setLabel("Ajouter un détail")
          .setEmoji("✍️")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

// ─── Publication côté staff ──────────────────────────────────────────────────

function feedbackEmbed(row: LeaveFeedbackRow): EmbedBuilder {
  const embed = logEmbed(LOG_COLOR.remove, "📉 Retour de départ")
    .setDescription(`<@${row.userId}> · \`@${row.username}\``)
    .addFields({ name: "Raison", value: reasonLabel(row.reason) })
    .setFooter({ text: `ID ${row.userId}` });

  if (row.comment) {
    embed.addFields({ name: "Précision", value: trim(row.comment) });
  }
  if (row.membershipMs) {
    embed.addFields({
      name: "Temps passé sur le serveur",
      value: formatDuration(row.membershipMs),
    });
  }
  return embed;
}

/**
 * Publie le retour dans le salon du staff — puis réédite ce même message si un
 * commentaire arrive après coup, pour ne pas dédoubler l'entrée.
 * Silencieux en cas d'échec : rien ne doit empêcher l'enregistrement en base.
 */
async function publishFeedback(
  client: CloverClient,
  row: LeaveFeedbackRow,
): Promise<void> {
  try {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) return;

    const cfg = await getGuildConfig(row.guildId);
    const channelId = cfg.leaveFeedbackChannelId ?? cfg.logChannelId;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isSendable()) return;

    const payload = { embeds: [feedbackEmbed(row)] };

    if (row.staffMessageId) {
      const existing = await channel.messages
        .fetch(row.staffMessageId)
        .catch(() => null);
      if (existing) {
        await existing.edit(payload);
        return;
      }
    }

    const message = await channel.send(payload);
    await db
      .update(botLeaveFeedback)
      .set({ staffMessageId: message.id })
      .where(eq(botLeaveFeedback.id, row.id));
  } catch (err) {
    logger.warn(
      { err, guildId: row.guildId },
      "Publication d'un retour de départ impossible",
    );
  }
}

// ─── Statistiques (`/config accueil retours`) ────────────────────────────────

export interface LeaveFeedbackStats {
  total: number;
  answered: number;
  declined: number;
  unreachable: number;
  reasons: { reason: string; count: number }[];
  comments: { username: string; reason: string | null; comment: string }[];
}

/** Agrégat des départs des `days` derniers jours. */
export async function getLeaveFeedbackStats(
  guildId: string,
  days: number,
): Promise<LeaveFeedbackStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const scope = and(
    eq(botLeaveFeedback.guildId, guildId),
    gte(botLeaveFeedback.leftAt, since),
  );

  const [totals] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      answered: sql<number>`cast(count(*) filter (where ${botLeaveFeedback.status} = 'ANSWERED') as int)`,
      declined: sql<number>`cast(count(*) filter (where ${botLeaveFeedback.status} = 'DECLINED') as int)`,
      unreachable: sql<number>`cast(count(*) filter (where ${botLeaveFeedback.status} = 'UNREACHABLE') as int)`,
    })
    .from(botLeaveFeedback)
    .where(scope);

  const reasons = await db
    .select({
      reason: botLeaveFeedback.reason,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(botLeaveFeedback)
    .where(and(scope, isNotNull(botLeaveFeedback.reason)))
    .groupBy(botLeaveFeedback.reason)
    .orderBy(desc(sql`count(*)`));

  const comments = await db
    .select({
      username: botLeaveFeedback.username,
      reason: botLeaveFeedback.reason,
      comment: botLeaveFeedback.comment,
    })
    .from(botLeaveFeedback)
    .where(and(scope, isNotNull(botLeaveFeedback.comment)))
    .orderBy(desc(botLeaveFeedback.leftAt))
    .limit(3);

  return {
    total: totals?.total ?? 0,
    answered: totals?.answered ?? 0,
    declined: totals?.declined ?? 0,
    unreachable: totals?.unreachable ?? 0,
    reasons: reasons.flatMap((r) =>
      r.reason ? [{ reason: r.reason, count: r.count }] : [],
    ),
    comments: comments.flatMap((c) =>
      c.comment
        ? [{ username: c.username, reason: c.reason, comment: c.comment }]
        : [],
    ),
  };
}

/** Embed de `/config accueil retours` : barres proportionnelles + verbatims. */
export function statsEmbed(
  stats: LeaveFeedbackStats,
  days: number,
): EmbedBuilder {
  const embed = brandEmbed()
    .setTitle("📉 Pourquoi les membres partent")
    .setFooter({
      text: `${stats.total} départ(s) sondé(s) sur ${days} jours • ${stats.answered} réponse(s), ${stats.declined} refus, ${stats.unreachable} MP non remis`,
    });

  if (!stats.reasons.length) {
    embed.setDescription(
      stats.total
        ? "Aucun membre n'a encore répondu au sondage sur cette période."
        : "Aucun départ enregistré sur cette période.",
    );
    return embed;
  }

  const max = Math.max(...stats.reasons.map((r) => r.count));
  embed.setDescription(
    stats.reasons
      .map(({ reason, count }) => {
        const bar = "▰".repeat(Math.round((count / max) * 10)).padEnd(10, "▱");
        const share = Math.round((count / stats.answered) * 100);
        return `\`${bar}\` **${count}** (${share} %) · ${reasonLabel(reason)}`;
      })
      .join("\n"),
  );

  if (stats.comments.length) {
    embed.addFields({
      name: "Derniers commentaires",
      value: trim(
        stats.comments
          .map((c) => `**@${c.username}** — ${trim(c.comment, 250)}`)
          .join("\n\n"),
      ),
    });
  }
  return embed;
}
