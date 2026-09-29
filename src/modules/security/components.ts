import { MessageFlags } from "discord.js";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import type { ComponentHandler, ComponentInteraction } from "../../types";
import { restoreBackup } from "./backups";
import { approveBot, kickQuarantinedBot } from "./bot-quarantine";
import { getIncident, undoIncident } from "./incidents";
import { AUTHORITY_REFUSAL, hasSecurityAuthority } from "./trust";
import { handleCaptchaModal, handleVerifyButton, showCaptchaModal } from "./verification";

async function reply(interaction: ComponentInteraction, ok: boolean, text: string) {
  const payload = { embeds: [ok ? successEmbed(text) : errorEmbed(text)] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/**
 * Boutons et modals du préfixe `secu`. La vérification est ouverte à tous ;
 * toute autre action (annuler une mesure, décider d'un bot, restaurer) exige
 * l'autorité de sécurité.
 */
export const handleSecurityComponent: ComponentHandler = async (interaction, action, args) => {
  if (action === "verify" && interaction.isButton()) return handleVerifyButton(interaction);
  if (action === "captcha" && interaction.isButton()) return showCaptchaModal(interaction);
  if (action === "captcha-modal" && interaction.isModalSubmit()) return handleCaptchaModal(interaction);

  if (!(await hasSecurityAuthority(interaction.guild, interaction.user.id))) {
    await reply(interaction, false, AUTHORITY_REFUSAL);
    return;
  }
  const [arg = ""] = args;

  switch (action) {
    case "undo": {
      const incident = await getIncident(interaction.guildId, Number(arg));
      if (!incident) return reply(interaction, false, "Incident introuvable.");
      if (incident.resolvedAt) return reply(interaction, false, "Cet incident a déjà été annulé.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const done = await undoIncident(interaction.guild, incident, interaction.user.id);
      return reply(interaction, true, done.length ? done.join("\n") : "Rien à annuler.");
    }
    case "bot-ok": {
      const error = await approveBot(interaction.guild, arg, interaction.user.id);
      return reply(interaction, !error, error ?? `<@${arg}> est autorisé : ses permissions lui sont rendues.`);
    }
    case "bot-kick": {
      const error = await kickQuarantinedBot(interaction.guild, arg, interaction.user.id);
      return reply(interaction, !error, error ?? `<@${arg}> a été expulsé.`);
    }
    case "restore": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await reply(interaction, true, "Restauration en cours… Cela peut prendre plusieurs minutes.");
      const report = await restoreBackup(interaction.guild, Number(arg), interaction.user.id).catch(
        (err: unknown) => err as Error,
      );
      if (report instanceof Error) return reply(interaction, false, `Restauration interrompue : ${report.message}`);
      return reply(
        interaction,
        true,
        [
          `Sauvegarde #${arg} restaurée.`,
          `Rôles : ${report.rolesCreated} recréé(s), ${report.rolesUpdated} corrigé(s)`,
          `Salons : ${report.channelsCreated} recréé(s), ${report.channelsUpdated} corrigé(s)`,
          `Messages republiés : ${report.messages}`,
        ].join("\n"),
      );
    }
    case "cancel":
      return reply(interaction, true, "Annulé.");
  }
};
