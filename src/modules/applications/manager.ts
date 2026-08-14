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
import { env } from "../../config";
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
import { getLinkedAccount } from "../sync/manager";
import type { ComponentHandler } from "../../types";

export type ApplicationRow = typeof botApplications.$inferSelect;
export type ApplicationStatus = "PENDING" | "ACCEPTED" | "REFUSED";

interface Question {
  /** Libellé du champ : 45 caractères au maximum (limite Discord). */
  label: string;
  /** Reformulation complète de la question : 100 caractères au maximum. */
  hint: string;
  /** Champ multiligne (les questions ouvertes) plutôt que ligne simple. */
  long?: boolean;
}

interface Position {
  label: string;
  emoji: string;
  description: string;
  /** 5 questions au maximum : c'est la limite d'une modale Discord. */
  questions: Question[];
}

/**
 * Tronc commun, repris du formulaire du site (`COMMON_QUESTIONS` de
 * `siteweb/src/lib/db/recruitment-defaults.ts`). Le pseudo Minecraft n'y
 * figure pas : il est résolu automatiquement depuis la liaison du candidat.
 */
const COMMON_QUESTIONS: Question[] = [
  {
    label: "Temps disponible par semaine",
    hint: "Moins de 5h, 5 à 10h, 10 à 20h ou plus — mieux vaut peu mais régulier.",
  },
  {
    label: "Sanctions déjà reçues",
    hint: "Ici ou ailleurs : sanction, motif, ce que tu en as retenu. « Aucune » sinon.",
  },
];

/**
 * Postes ouverts aux candidatures, calqués sur ceux du site
 * (`DEFAULT_ROLES` / `ROLE_QUESTIONS` du même fichier).
 *
 * Le site pose une dizaine de questions en trois étapes, avec envoi d'images ;
 * une modale Discord plafonne à cinq champs texte. On garde donc les deux
 * questions communes les plus discriminantes, puis trois questions du poste —
 * une de parcours, deux de maîtrise — et le panneau renvoie au formulaire
 * complet pour les dossiers qui demandent un portfolio.
 */
export const APPLICATION_POSITIONS: Record<string, Position> = {
  support: {
    label: "Support",
    emoji: "🎧",
    description: "Aider les joueurs dans leurs demandes et traiter les tickets de support.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Ce que tu connais des modes de jeu",
        hint: "Lesquels as-tu joués, combien de temps, quelles questions reviennent chez les joueurs ?",
        long: true,
      },
      {
        label: "Joueur énervé : stuff perdu sur un bug",
        hint: "Ce que tu lui écris, ce que tu lui demandes, ce que tu vérifies, à qui tu transmets.",
        long: true,
      },
      {
        label: "Quand tu ne connais pas la réponse",
        hint: "Ta démarche concrète : où tu cherches, qui tu sollicites.",
        long: true,
      },
    ],
  },
  moderateur: {
    label: "Modérateur",
    emoji: "🛡️",
    description:
      "Faire respecter les règles et assurer une ambiance saine sur le serveur et Discord.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Ton expérience de la modération",
        hint: "Communautés modérées et leur taille, outils utilisés, durée, conflits gérés.",
        long: true,
      },
      {
        label: "Un habitué et un nouveau s'insultent",
        hint: "Tes actions dans l'ordre, les sanctions envisagées, les preuves que tu conserves.",
        long: true,
      },
      {
        label: "Avertissement, mute, kick, bannissement",
        hint: "Sur quels critères passes-tu de l'un à l'autre ? Le barème est sur le wiki.",
        long: true,
      },
    ],
  },
  architecte: {
    label: "Architecte",
    emoji: "🗺️",
    description: "Concevoir et construire les décors et structures du serveur.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Où voir tes constructions",
        hint: "Portfolio, galerie, Planet Minecraft, vidéo, Drive… décris brièvement chaque lien.",
        long: true,
      },
      {
        label: "Tes styles et tes outils",
        hint: "Médiéval, moderne, terraforming… WorldEdit, VoxelSniper, Axiom, Blender.",
        long: true,
      },
      {
        label: "Rendre une arène PvP jouable",
        hint: "Lisibilité en combat, points d'apparition, accès et échappatoires, entités coûteuses.",
        long: true,
      },
    ],
  },
  graphiste: {
    label: "Graphiste",
    emoji: "✨",
    description: "Créer les visuels, bannières et éléments graphiques de la communauté.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Lien vers ton portfolio",
        hint: "Behance, ArtStation, X, Instagram, Drive, salon Discord… plusieurs liens si besoin.",
        long: true,
      },
      {
        label: "Visuels et logiciels maîtrisés",
        hint: "Bannières, logos, miniatures, habillage Discord… et Photoshop, Illustrator, Figma.",
        long: true,
      },
      {
        label: "Visuel Discord ou visuel boutique",
        hint: "Qu'est-ce qui change entre les deux ? Format, poids, lisibilité en miniature…",
        long: true,
      },
    ],
  },
  redacteur: {
    label: "Rédacteur",
    emoji: "📰",
    description: "Écrire et maintenir la documentation du wiki, les articles et les annonces.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Montre-nous ce que tu as écrit",
        hint: "Articles, wiki, blog, guides, posts Discord. Sans lien public, colle un extrait.",
        long: true,
      },
      {
        label: "Annonce d'ouverture d'un mode",
        hint: "Exercice : rédige-la. Quelques lignes suffisent, tu choisis le ton et le format.",
        long: true,
      },
      {
        label: "Documenter un mode que tu ne connais pas",
        hint: "Qui tu vas voir, ce que tu testes toi-même, comment tu vérifies avant de publier.",
        long: true,
      },
    ],
  },
  developpeur: {
    label: "Développeur",
    emoji: "🔧",
    description: "Contribuer au développement du serveur Minecraft ou de la plateforme web.",
    questions: [
      ...COMMON_QUESTIONS,
      {
        label: "Ton GitHub ou du code que tu as écrit",
        hint: "Dépôts publics, plugins publiés, sites en ligne. Précise ce que tu as écrit toi-même.",
        long: true,
      },
      {
        label: "Langages et technologies maîtrisés",
        hint: "Java, API Spigot/Paper, SQL, TypeScript, React/Next.js, Docker… et depuis quand.",
        long: true,
      },
      {
        label: "Thread principal et asynchrone sur Paper",
        hint: "La différence, et ce qu'on ne fait jamais en asynchrone. Réponds avec tes mots.",
        long: true,
      },
    ],
  },
};

/** Formulaire complet du site, seul à accepter portfolios et captures. */
const RECRUITMENT_URL = `${env.WEBSITE_URL.replace(/\/$/, "")}/recruitment`;

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
    .setTitle("📝 Rejoindre l'équipe")
    .setDescription(
      open
        ? [
            "> Choisis ton poste ci-dessous et remplis le formulaire.",
            "> Le staff te répond en message privé.",
            "",
            "**Postes ouverts**",
            Object.values(APPLICATION_POSITIONS)
              .map((p) => `${p.emoji} ${p.label}`)
              .join("  ·  "),
            "",
            `Dossier avec portfolio ou captures ? [Formulaire complet](${RECRUITMENT_URL})`,
          ].join("\n")
        : [
            "> 🔒 Les candidatures sont **fermées** pour le moment.",
            "> Reviens plus tard, ou tente ta chance sur le site.",
            "",
            `[Formulaire du site](${RECRUITMENT_URL})`,
          ].join("\n"),
    )
    .setFooter({
      text: "Une seule candidature à la fois • Réponse en message privé",
    });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId("cand", "choose"))
    .setPlaceholder(open ? "Choisis le poste qui te correspond…" : "Candidatures fermées")
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
  minecraftUsername?: string | null,
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

  if (minecraftUsername) {
    embed.addFields({
      name: "Compte Minecraft",
      value: `\`${minecraftUsername}\``,
      inline: true,
    });
  }

  const questions = position?.questions ?? [];
  embed.addFields(
    row.answers.map((answer, i) => ({
      name: questions[i]?.label ?? `Question ${i + 1}`,
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
                .setLabel(question.label.slice(0, 45))
                .setPlaceholder(question.hint.slice(0, 100))
                .setStyle(question.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(question.long ? 1_000 : 200),
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

    const [applicant, linked] = await Promise.all([
      interaction.client.users.fetch(row.userId).catch(() => null),
      getLinkedAccount(row.userId).catch(() => null),
    ]);
    if (interaction.message) {
      await interaction.message
        .edit({
          embeds: [buildApplicationEmbed(row, applicant, linked?.minecraftUsername)],
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

  // Le pseudo Minecraft n'est pas demandé dans le formulaire : il vient de la
  // liaison du candidat, ce qui évite une question de plus et une faute de frappe.
  const linked = await getLinkedAccount(row.userId).catch(() => null);

  const message = await channel
    .send({
      embeds: [buildApplicationEmbed(row, applicant, linked?.minecraftUsername)],
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
