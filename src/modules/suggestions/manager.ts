import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type User,
} from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botSuggestionVotes, botSuggestions } from "../../db/schema";
import {
  BRAND_COLOR,
  ERROR_COLOR,
  WARN_COLOR,
  brandEmbed,
  errorEmbed,
  successEmbed,
} from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import type { ComponentHandler } from "../../types";

export type SuggestionRow = typeof botSuggestions.$inferSelect;
export type SuggestionStatus = "PENDING" | "ACCEPTED" | "REFUSED" | "DONE";

const STATUS_META: Record<
  SuggestionStatus,
  { label: string; icon: string; color: number }
> = {
  PENDING: { label: "En attente", icon: "💡", color: BRAND_COLOR },
  ACCEPTED: { label: "Acceptée", icon: "✅", color: BRAND_COLOR },
  REFUSED: { label: "Refusée", icon: "❌", color: ERROR_COLOR },
  DONE: { label: "Réalisée", icon: "🎉", color: BRAND_COLOR },
};

interface VoteTally {
  up: number;
  down: number;
}

async function tally(suggestionId: number): Promise<VoteTally> {
  const [row] = await db
    .select({
      up: sql<number>`count(*) filter (where ${botSuggestionVotes.value} = 1)::int`,
      down: sql<number>`count(*) filter (where ${botSuggestionVotes.value} = -1)::int`,
    })
    .from(botSuggestionVotes)
    .where(eq(botSuggestionVotes.suggestionId, suggestionId));
  return { up: row?.up ?? 0, down: row?.down ?? 0 };
}

export function buildSuggestionEmbed(
  row: SuggestionRow,
  author: User | null,
  votes: VoteTally,
): EmbedBuilder {
  const meta = STATUS_META[row.status as SuggestionStatus] ?? STATUS_META.PENDING;
  const total = votes.up + votes.down;
  const ratio = total ? Math.round((votes.up / total) * 100) : 0;

  const embed = brandEmbed()
    .setColor(meta.color)
    .setTitle(`${meta.icon} Suggestion #${row.id} · ${meta.label}`)
    .setDescription(row.content)
    .addFields({
      name: "Votes",
      value: total
        ? `👍 **${votes.up}** · 👎 **${votes.down}** — ${ratio} % d'avis favorables`
        : "Aucun vote pour l'instant",
    })
    .setTimestamp(row.createdAt);

  if (author) {
    embed.setAuthor({
      name: author.tag,
      iconURL: author.displayAvatarURL({ size: 64 }),
    });
  }
  if (row.decidedBy) {
    embed.addFields({
      name: `Décision de ${meta.label.toLowerCase()}`,
      value: `<@${row.decidedBy}>${row.decisionReason ? ` — ${row.decisionReason}` : ""}`,
    });
  }
  return embed;
}

export function buildSuggestionButtons(
  row: SuggestionRow,
  votes: VoteTally,
): ActionRowBuilder<ButtonBuilder>[] {
  const closed = row.status !== "PENDING";
  const voteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("sugg", "up", row.id))
      .setEmoji("👍")
      .setLabel(String(votes.up))
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(buildId("sugg", "down", row.id))
      .setEmoji("👎")
      .setLabel(String(votes.down))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );
  if (closed) return [voteRow];

  // Boutons de décision : visibles par tous, mais refusés à qui n'a pas la
  // permission « Gérer le serveur » (Discord ne sait pas masquer par rôle).
  voteRow.addComponents(
    new ButtonBuilder()
      .setCustomId(buildId("sugg", "decide", row.id))
      .setEmoji("⚖️")
      .setLabel("Décider (staff)")
      .setStyle(ButtonStyle.Secondary),
  );
  return [voteRow];
}

/** Publie la suggestion dans le salon configuré. */
export async function createSuggestion(
  guild: Guild,
  author: User,
  content: string,
): Promise<{ ok: true; row: SuggestionRow } | { ok: false; error: string }> {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.suggestionChannelId) {
    return {
      ok: false,
      error: "Aucun salon de suggestions configuré (`/config suggestions salon`).",
    };
  }

  const channel = await guild.channels
    .fetch(cfg.suggestionChannelId)
    .catch(() => null);
  if (!channel?.isSendable()) {
    return {
      ok: false,
      error: "Le salon de suggestions est introuvable ou je ne peux pas y écrire.",
    };
  }

  const [row] = await db
    .insert(botSuggestions)
    .values({
      guildId: guild.id,
      channelId: cfg.suggestionChannelId,
      authorId: author.id,
      content,
    })
    .returning();
  if (!row) return { ok: false, error: "Suggestion non enregistrée." };

  const votes = { up: 0, down: 0 };
  const message = await channel.send({
    embeds: [buildSuggestionEmbed(row, author, votes)],
    components: buildSuggestionButtons(row, votes),
  });

  await db
    .update(botSuggestions)
    .set({ messageId: message.id })
    .where(eq(botSuggestions.id, row.id));

  return { ok: true, row: { ...row, messageId: message.id } };
}

/** Boutons 👍 / 👎 / ⚖️ et modale de décision. */
export const handleSuggestionComponent: ComponentHandler = async (
  interaction,
  action,
  args,
) => {
  const id = Number(args[0]);
  if (!Number.isFinite(id)) return;

  const [row] = await db
    .select()
    .from(botSuggestions)
    .where(eq(botSuggestions.id, id))
    .limit(1);
  if (!row || row.guildId !== interaction.guild.id) {
    await interaction.reply({
      embeds: [errorEmbed("Cette suggestion n'existe plus.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "up" || action === "down") {
    if (row.status !== "PENDING") {
      await interaction.reply({
        embeds: [errorEmbed("Le vote est clos sur cette suggestion.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const value = action === "up" ? 1 : -1;
    const [existing] = await db
      .select()
      .from(botSuggestionVotes)
      .where(
        and(
          eq(botSuggestionVotes.suggestionId, id),
          eq(botSuggestionVotes.userId, interaction.user.id),
        ),
      )
      .limit(1);

    let message: string;
    if (existing?.value === value) {
      // Recliquer sur le même bouton retire le vote (comme les giveaways).
      await db
        .delete(botSuggestionVotes)
        .where(
          and(
            eq(botSuggestionVotes.suggestionId, id),
            eq(botSuggestionVotes.userId, interaction.user.id),
          ),
        );
      message = "↩️ Vote retiré.";
    } else {
      await db
        .insert(botSuggestionVotes)
        .values({ suggestionId: id, userId: interaction.user.id, value })
        .onConflictDoUpdate({
          target: [botSuggestionVotes.suggestionId, botSuggestionVotes.userId],
          set: { value },
        });
      message = value === 1 ? "👍 Vote enregistré." : "👎 Vote enregistré.";
    }

    await interaction.reply({
      embeds: [brandEmbed().setDescription(message)],
      flags: MessageFlags.Ephemeral,
    });
    await refreshSuggestionMessage(interaction.guild, row);
    return;
  }

  if (action === "decide") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [errorEmbed("Seul le staff peut statuer sur une suggestion.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!interaction.isButton()) return;

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(buildId("sugg", "decided", id))
        .setTitle(`Suggestion #${id}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("statut")
              .setLabel("Décision : accepte, refuse ou fait")
              .setPlaceholder("accepte / refuse / fait")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(16),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("raison")
              .setLabel("Motif communiqué à l'auteur")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        ),
    );
    return;
  }

  if (action === "decided") {
    if (!interaction.isModalSubmit()) return;
    const raw = interaction.fields.getTextInputValue("statut").trim().toLowerCase();
    const status = parseStatus(raw);
    if (!status) {
      await interaction.reply({
        embeds: [errorEmbed("Décision inconnue : écris `accepte`, `refuse` ou `fait`.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const reason = interaction.fields.getTextInputValue("raison").trim() || null;

    const [updated] = await db
      .update(botSuggestions)
      .set({
        status,
        decidedBy: interaction.user.id,
        decisionReason: reason,
        decidedAt: new Date(),
      })
      .where(eq(botSuggestions.id, id))
      .returning();

    await interaction.reply({
      embeds: [successEmbed(`Suggestion **#${id}** marquée « ${STATUS_META[status].label} ».`)],
      flags: MessageFlags.Ephemeral,
    });
    if (updated) await refreshSuggestionMessage(interaction.guild, updated);

    // L'auteur est prévenu en privé : il ne relit pas forcément le salon.
    const author = await interaction.client.users
      .fetch(row.authorId)
      .catch(() => null);
    await author
      ?.send({
        embeds: [
          brandEmbed()
            .setColor(STATUS_META[status].color)
            .setTitle(`${STATUS_META[status].icon} Ta suggestion a été ${STATUS_META[status].label.toLowerCase()}`)
            .setDescription(row.content)
            .addFields({ name: "Motif", value: reason ?? "Aucun motif précisé" }),
        ],
      })
      .catch(() => undefined);
  }
};

function parseStatus(raw: string): SuggestionStatus | null {
  if (raw.startsWith("acc")) return "ACCEPTED";
  if (raw.startsWith("ref")) return "REFUSED";
  if (raw.startsWith("fait") || raw.startsWith("don")) return "DONE";
  return null;
}

/** Réédite le message de la suggestion avec les compteurs à jour. */
export async function refreshSuggestionMessage(
  guild: Guild,
  row: SuggestionRow,
): Promise<void> {
  if (!row.messageId) return;

  const channel = await guild.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(row.messageId).catch(() => null);
  if (!message) return;

  const [votes, author] = await Promise.all([
    tally(row.id),
    guild.client.users.fetch(row.authorId).catch(() => null),
  ]);

  await message
    .edit({
      embeds: [buildSuggestionEmbed(row, author, votes)],
      components: buildSuggestionButtons(row, votes),
    })
    .catch((err) =>
      logger.debug({ err, suggestion: row.id }, "Actualisation de la suggestion impossible"),
    );
}

export { tally as suggestionVotes };
