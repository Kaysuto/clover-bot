import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type User,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botApplications } from "../../db/schema";
import {
  BRAND_COLOR,
  ERROR_COLOR,
  brandEmbed,
  errorEmbed,
  successEmbed,
} from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import type { ComponentHandler } from "../../types";

export type ApplicationRow = typeof botApplications.$inferSelect;
export type ApplicationStatus = "PENDING" | "ACCEPTED" | "REFUSED";

interface Position {
  label: string;
  emoji: string;
  description: string;
  /** 5 questions au maximum : c'est la limite d'une modale Discord. */
  questions: string[];
}

/**
 * Postes ouverts aux candidatures. Les questions sont posées dans une modale,
 * donc limitées à cinq et à 45 caractères de libellé (contraintes Discord).
 */
export const APPLICATION_POSITIONS: Record<string, Position> = {
  moderateur: {
    label: "Modérateur",
    emoji: "🛡️",
    description: "Veiller au respect du règlement, en jeu et sur Discord",
    questions: [
      "Ton âge et ton fuseau horaire",
      "Ton pseudo Minecraft",
      "Combien d'heures par semaine ?",
      "Ton expérience de la modération",
      "Pourquoi toi ?",
    ],
  },
  animateur: {
    label: "Animateur",
    emoji: "🎪",
    description: "Organiser des événements et animer la communauté",
    questions: [
      "Ton âge et ton fuseau horaire",
      "Ton pseudo Minecraft",
      "Combien d'heures par semaine ?",
      "Une idée d'événement à organiser",
      "Pourquoi toi ?",
    ],
  },
  builder: {
    label: "Builder",
    emoji: "🏗️",
    description: "Construire les maps et les décors du réseau",
    questions: [
      "Ton âge et ton fuseau horaire",
      "Ton pseudo Minecraft",
      "Combien d'heures par semaine ?",
      "Lien vers tes constructions",
      "Tes styles de prédilection",
    ],
  },
  developpeur: {
    label: "Développeur",
    emoji: "💻",
    description: "Développer les plugins et les outils du réseau",
    questions: [
      "Ton âge et ton fuseau horaire",
      "Ton pseudo Minecraft",
      "Combien d'heures par semaine ?",
      "Langages et API maîtrisés",
      "Lien vers ton code (GitHub…)",
    ],
  },
};

const STATUS_META: Record<
  ApplicationStatus,
  { label: string; icon: string; color: number }
> = {
  PENDING: { label: "En attente", icon: "📝", color: BRAND_COLOR },
  ACCEPTED: { label: "Acceptée", icon: "✅", color: BRAND_COLOR },
  REFUSED: { label: "Refusée", icon: "❌", color: ERROR_COLOR },
};

/** Panneau de dépôt : un menu déroulant listant les postes ouverts. */
export function buildApplicationPanel(open: boolean) {
  const embed = brandEmbed()
    .setTitle("📝 Rejoindre l'équipe Clover Games")
    .setDescription(
      open
        ? [
            "Choisis le poste qui te correspond dans le menu ci-dessous, puis remplis le formulaire.",
            "",
            ...Object.values(APPLICATION_POSITIONS).map(
              (p) => `${p.emoji} **${p.label}** — ${p.description}`,
            ),
            "",
            "_Une réponse te sera donnée en message privé. Une seule candidature en cours à la fois._",
          ].join("\n")
        : "🔒 Les candidatures sont **fermées** pour le moment. Reviens plus tard !",
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId("cand", "choose"))
    .setPlaceholder(open ? "Choisis un poste…" : "Candidatures fermées")
    .setDisabled(!open)
    .addOptions(
      Object.entries(APPLICATION_POSITIONS).map(([key, p]) => ({
        label: p.label,
        value: key,
        emoji: p.emoji,
        description: p.description.slice(0, 100),
      })),
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

export function buildApplicationEmbed(
  row: ApplicationRow,
  applicant: User | null,
): EmbedBuilder {
  const position = APPLICATION_POSITIONS[row.position];
  const meta = STATUS_META[row.status as ApplicationStatus] ?? STATUS_META.PENDING;

  const embed = brandEmbed()
    .setColor(meta.color)
    .setTitle(
      `${position?.emoji ?? "📝"} Candidature #${row.id} · ${position?.label ?? row.position}`,
    )
    .setDescription(`${meta.icon} **${meta.label}** — <@${row.userId}>`)
    .setTimestamp(row.createdAt);

  if (applicant) {
    embed.setAuthor({
      name: applicant.tag,
      iconURL: applicant.displayAvatarURL({ size: 64 }),
    });
  }

  const questions = position?.questions ?? [];
  embed.addFields(
    row.answers.map((answer, i) => ({
      name: questions[i] ?? `Question ${i + 1}`,
      value: answer.slice(0, 1_024) || "—",
    })),
  );

  if (row.reviewedBy) {
    embed.addFields({
      name: "Décision",
      value: `<@${row.reviewedBy}>${row.decisionReason ? ` — ${row.decisionReason}` : ""}`,
    });
  }
  return embed;
}

function reviewButtons(id: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("cand", "accept", id))
      .setLabel("Accepter")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildId("cand", "refuse", id))
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
  );
}

/** Menu du panneau, formulaire, puis décision du staff. */
export const handleApplicationComponent: ComponentHandler = async (
  interaction,
  action,
  args,
) => {
  const cfg = await getGuildConfig(interaction.guild.id);

  if (action === "choose") {
    if (!interaction.isStringSelectMenu()) return;
    const key = interaction.values[0] ?? "";
    const position = APPLICATION_POSITIONS[key];

    if (!cfg.applicationsOpen || !position) {
      await interaction.reply({
        embeds: [errorEmbed("Les candidatures sont fermées pour le moment.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [pending] = await db
      .select()
      .from(botApplications)
      .where(
        and(
          eq(botApplications.guildId, interaction.guild.id),
          eq(botApplications.userId, interaction.user.id),
          eq(botApplications.status, "PENDING"),
        ),
      )
      .limit(1);
    if (pending) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `Ta candidature **#${pending.id}** est déjà en cours d'examen. Patience ! 🍀`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(buildId("cand", "submit", key))
        .setTitle(`Candidature — ${position.label}`.slice(0, 45))
        .addComponents(
          position.questions.map((question, i) =>
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId(`q${i}`)
                .setLabel(question.slice(0, 45))
                .setStyle(i >= 3 ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(i >= 3 ? 1_000 : 200),
            ),
          ),
        ),
    );

    // Le menu reste sinon bloqué sur l'option choisie (même correctif que
    // le panneau de tickets).
    await interaction.message
      .edit(buildApplicationPanel(cfg.applicationsOpen))
      .catch(() => undefined);
    return;
  }

  if (action === "submit") {
    if (!interaction.isModalSubmit()) return;
    const key = args[0] ?? "";
    const position = APPLICATION_POSITIONS[key];
    if (!position) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const answers = position.questions.map((_, i) =>
      interaction.fields.getTextInputValue(`q${i}`),
    );

    const [row] = await db
      .insert(botApplications)
      .values({
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        position: key,
        answers,
      })
      .returning();
    if (!row) {
      await interaction.editReply({
        embeds: [errorEmbed("Candidature non enregistrée, réessaie dans un instant.")],
      });
      return;
    }

    const posted = await postForReview(interaction.guild, row, interaction.user);
    await interaction.editReply({
      embeds: [
        posted
          ? successEmbed(
              `Candidature **#${row.id}** envoyée ! Tu recevras la réponse en message privé.`,
            )
          : errorEmbed(
              `Candidature **#${row.id}** enregistrée, mais le salon du staff n'est pas configuré (\`/config candidatures salon-staff\`).`,
            ),
      ],
    });
    return;
  }

  if (action === "accept" || action === "refuse") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed("Seul le staff peut statuer sur une candidature.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!interaction.isButton()) return;

    const id = Number(args[0]);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(buildId("cand", `decided-${action}`, id))
        .setTitle(action === "accept" ? "Accepter la candidature" : "Refuser la candidature")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("raison")
              .setLabel("Message envoyé au candidat")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        ),
    );
    return;
  }

  if (action === "decided-accept" || action === "decided-refuse") {
    if (!interaction.isModalSubmit()) return;
    const id = Number(args[0]);
    const status: ApplicationStatus =
      action === "decided-accept" ? "ACCEPTED" : "REFUSED";
    const reason = interaction.fields.getTextInputValue("raison").trim() || null;

    const [row] = await db
      .update(botApplications)
      .set({
        status,
        reviewedBy: interaction.user.id,
        reviewedAt: new Date(),
        decisionReason: reason,
      })
      .where(
        and(eq(botApplications.id, id), eq(botApplications.status, "PENDING")),
      )
      .returning();

    if (!row) {
      await interaction.reply({
        embeds: [errorEmbed("Cette candidature a déjà été traitée.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          `Candidature **#${id}** ${status === "ACCEPTED" ? "acceptée" : "refusée"}.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });

    const applicant = await interaction.client.users.fetch(row.userId).catch(() => null);
    if (interaction.message) {
      await interaction.message
        .edit({
          embeds: [buildApplicationEmbed(row, applicant)],
          components: [],
        })
        .catch(() => undefined);
    }

    const meta = STATUS_META[status];
    const position = APPLICATION_POSITIONS[row.position];
    await applicant
      ?.send({
        embeds: [
          brandEmbed()
            .setColor(meta.color)
            .setAuthor({
              name: interaction.guild.name,
              iconURL: interaction.guild.iconURL() ?? undefined,
            })
            .setTitle(`${meta.icon} Candidature ${meta.label.toLowerCase()}`)
            .setDescription(
              status === "ACCEPTED"
                ? `Bravo ! Ta candidature au poste de **${position?.label ?? row.position}** a été acceptée. 🍀`
                : `Ta candidature au poste de **${position?.label ?? row.position}** n'a pas été retenue cette fois-ci.`,
            )
            .addFields({ name: "Message du staff", value: reason ?? "Aucun message" }),
        ],
      })
      .catch(() =>
        logger.debug({ userId: row.userId }, "Décision non notifiée (MP fermés ?)"),
      );
  }
};

/** Publie la candidature dans le salon du staff, avec les boutons de décision. */
async function postForReview(
  guild: Guild,
  row: ApplicationRow,
  applicant: User,
): Promise<boolean> {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.applicationReviewChannelId) return false;

  const channel = await guild.channels
    .fetch(cfg.applicationReviewChannelId)
    .catch(() => null);
  if (!channel?.isSendable()) return false;

  const message = await channel
    .send({
      embeds: [buildApplicationEmbed(row, applicant)],
      components: [reviewButtons(row.id)],
    })
    .catch((err) => {
      logger.warn({ err, application: row.id }, "Publication de la candidature impossible");
      return null;
    });
  if (!message) return false;

  await db
    .update(botApplications)
    .set({ messageId: message.id })
    .where(eq(botApplications.id, row.id));
  return true;
}

/**
 * Republie ou réédite le panneau de candidatures au démarrage : les boutons
 * survivent aux redémarrages, mais l'état ouvert/fermé doit être à jour.
 */
export async function refreshApplicationPanels(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.applicationPanelChannelId) continue;

    const channel = await guild.channels
      .fetch(cfg.applicationPanelChannelId)
      .catch(() => null);
    if (!channel?.isSendable()) continue;

    const payload = buildApplicationPanel(cfg.applicationsOpen);

    if (cfg.applicationPanelMessageId) {
      const message = await channel.messages
        .fetch(cfg.applicationPanelMessageId)
        .catch(() => null);
      if (message) {
        await message.edit(payload).catch(() => undefined);
        continue;
      }
    }

    const sent = await channel.send(payload).catch((err) => {
      logger.warn({ err, guildId: guild.id }, "Panneau de candidatures non publié");
      return null;
    });
    if (sent) {
      await updateGuildConfig(guild.id, { applicationPanelMessageId: sent.id });
    }
  }
}
