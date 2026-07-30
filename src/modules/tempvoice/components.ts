import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type VoiceChannel,
} from "discord.js";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import type { ComponentHandler, ComponentInteraction } from "../../types";
import {
  type ActionResult,
  claimVoice,
  kickFromVoice,
  lockVoice,
  renameVoice,
  requireOwner,
  setVoiceLimit,
  transferVoice,
  unlockVoice,
} from "./actions";
import {
  getTempVoiceRowByText,
  refreshVoicePanel,
  type TempVoiceRow,
} from "./manager";

/** Actions dont le résultat est visible dans le panneau (verrou, places, propriétaire). */
const PANEL_ACTIONS = new Set([
  "lock",
  "unlock",
  "limitmodal",
  "transferpick",
  "claim",
]);

async function respond(
  interaction: ComponentInteraction,
  result: ActionResult,
): Promise<void> {
  await interaction.reply({
    embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Modale d'une valeur unique (places, nom) — Discord n'a pas de champ nombre. */
function singleFieldModal(
  action: string,
  title: string,
  label: string,
  placeholder: string,
  maxLength: number,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildId("voc", action))
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(label)
          .setPlaceholder(placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(maxLength),
      ),
    );
}

/**
 * Menu éphémère listant les membres du vocal : plus sûr qu'une saisie de pseudo
 * et limité aux personnes réellement présentes.
 */
async function pickMember(
  interaction: ComponentInteraction,
  voice: VoiceChannel,
  row: TempVoiceRow,
  action: "kickpick" | "transferpick",
): Promise<void> {
  const others = [...voice.members.values()].filter(
    (m) => !m.user.bot && m.id !== row.ownerId,
  );
  if (!others.length) {
    await respond(interaction, {
      ok: false,
      message: "Il n'y a personne d'autre que toi dans le vocal.",
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildId("voc", action))
    .setPlaceholder(
      action === "kickpick" ? "Qui expulser du vocal ?" : "À qui céder le vocal ?",
    )
    .addOptions(
      others.slice(0, 25).map((m) => ({
        label: m.displayName.slice(0, 100),
        value: m.id,
        description: `@${m.user.username}`.slice(0, 100),
      })),
    );

  await interaction.reply({
    embeds: [
      brandEmbed().setDescription(
        action === "kickpick"
          ? "👢 Choisis le membre à expulser de ton vocal."
          : "👑 Choisis le nouveau propriétaire du vocal.",
      ),
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

export const handleTempVoiceComponent: ComponentHandler = async (
  interaction,
  action,
) => {
  // Le contexte vient du salon texte où vivent les boutons.
  const row = interaction.channelId
    ? await getTempVoiceRowByText(interaction.channelId)
    : null;
  const voice = row
    ? (interaction.guild.channels.cache.get(row.voiceChannelId) as
        | VoiceChannel
        | undefined)
    : undefined;
  if (!row || !voice) {
    await respond(interaction, {
      ok: false,
      message: "Ces boutons ne fonctionnent que dans le salon texte d'un vocal temporaire.",
    });
    return;
  }
  if (interaction.member.voice.channelId !== voice.id) {
    await respond(interaction, {
      ok: false,
      message: "Tu dois être connecté au vocal pour le gérer.",
    });
    return;
  }

  // Répond puis reflète le nouvel état dans le panneau si l'action l'a changé.
  const finish = async (result: ActionResult): Promise<void> => {
    await respond(interaction, result);
    if (result.ok && PANEL_ACTIONS.has(action)) {
      await refreshVoicePanel(interaction.guild, voice.id);
    }
  };

  // « Réclamer » est le seul cas ouvert aux non-propriétaires.
  if (action === "claim") {
    await finish(await claimVoice(voice, row, interaction.member));
    return;
  }

  const denied = requireOwner(row, interaction.user.id);
  if (denied) {
    await respond(interaction, denied);
    return;
  }

  // ── Modales : saisie puis application ──
  if (interaction.isModalSubmit()) {
    const value = interaction.fields.getTextInputValue("value");
    if (action === "limitmodal") {
      await finish(await setVoiceLimit(voice, row, Number(value.trim())));
    } else if (action === "renamemodal") {
      await finish(await renameVoice(voice, value));
    }
    return;
  }

  switch (action) {
    case "lock":
      await finish(await lockVoice(voice, row));
      return;
    case "unlock":
      await finish(await unlockVoice(voice, row));
      return;
    case "limit":
      await interaction.showModal(
        singleFieldModal(
          "limitmodal",
          "Nombre de places",
          "Places (0 = illimité)",
          "Entre 0 et 99",
          2,
        ),
      );
      return;
    case "rename":
      await interaction.showModal(
        singleFieldModal(
          "renamemodal",
          "Renommer le vocal",
          "Nouveau nom",
          "Le nom de ton vocal",
          90,
        ),
      );
      return;
    case "kick":
      await pickMember(interaction, voice, row, "kickpick");
      return;
    case "transfer":
      await pickMember(interaction, voice, row, "transferpick");
      return;
    case "kickpick":
    case "transferpick": {
      if (!interaction.isStringSelectMenu()) return;
      const targetId = interaction.values[0];
      const target = targetId
        ? await interaction.guild.members.fetch(targetId).catch(() => null)
        : null;
      const result = !target
        ? { ok: false, message: "Membre introuvable." }
        : action === "kickpick"
          ? await kickFromVoice(voice, row, target)
          : await transferVoice(voice, row, target);
      await interaction.update({
        embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)],
        components: [],
      });
      if (result.ok && PANEL_ACTIONS.has(action)) {
        await refreshVoicePanel(interaction.guild, voice.id);
      }
      return;
    }
  }
};
