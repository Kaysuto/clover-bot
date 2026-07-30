import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type VoiceChannel,
} from "discord.js";
import { errorEmbed, successEmbed } from "../../lib/embeds";
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
} from "../../modules/tempvoice/actions";
import {
  getTempVoiceRow,
  refreshVoicePanel,
} from "../../modules/tempvoice/manager";
import type { Command } from "../../types";

/** Sous-commandes dont le résultat est affiché dans le panneau du salon texte. */
const PANEL_SUBCOMMANDS = new Set([
  "verrouiller",
  "deverrouiller",
  "limite",
  "transferer",
  "claim",
]);

const voc: Command = {
  data: new SlashCommandBuilder()
    .setName("voc")
    .setDescription("Gérer ton vocal temporaire")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName("verrouiller").setDescription("Empêcher de nouvelles personnes de rejoindre"),
    )
    .addSubcommand((s) =>
      s.setName("deverrouiller").setDescription("Rouvrir le vocal à tous"),
    )
    .addSubcommand((s) =>
      s
        .setName("limite")
        .setDescription("Limiter le nombre de places")
        .addIntegerOption((o) =>
          o
            .setName("nombre")
            .setDescription("Nombre de places (0 = illimité)")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("renommer")
        .setDescription("Renommer le vocal")
        .addStringOption((o) =>
          o.setName("nom").setDescription("Nouveau nom").setRequired(true).setMaxLength(90),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("expulser")
        .setDescription("Expulser un membre du vocal")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre à expulser").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("transferer")
        .setDescription("Donner la propriété du vocal à un membre")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Nouveau propriétaire").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("claim")
        .setDescription("Récupérer la propriété si le propriétaire est parti"),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const voice = interaction.member.voice.channel as VoiceChannel | null;
    const row = voice ? await getTempVoiceRow(voice.id) : null;

    if (!voice || !row) {
      await interaction.reply({
        embeds: [errorEmbed("Tu dois être dans un vocal temporaire pour utiliser cette commande.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const respond = async (result: ActionResult) => {
      await interaction.reply({
        embeds: [result.ok ? successEmbed(result.message) : errorEmbed(result.message)],
        flags: MessageFlags.Ephemeral,
      });
      // Le panneau du salon texte doit refléter l'état, même modifié en slash.
      if (result.ok && PANEL_SUBCOMMANDS.has(sub)) {
        await refreshVoicePanel(interaction.guild, voice.id);
      }
    };

    // /voc claim : seul cas ouvert aux non-propriétaires
    if (sub === "claim") {
      await respond(await claimVoice(voice, row, interaction.member));
      return;
    }

    const denied = requireOwner(row, interaction.user.id);
    if (denied) {
      await respond(denied);
      return;
    }

    switch (sub) {
      case "verrouiller":
        await respond(await lockVoice(voice, row));
        return;
      case "deverrouiller":
        await respond(await unlockVoice(voice, row));
        return;
      case "limite":
        await respond(
          await setVoiceLimit(voice, row, interaction.options.getInteger("nombre", true)),
        );
        return;
      case "renommer":
        await respond(
          await renameVoice(voice, interaction.options.getString("nom", true)),
        );
        return;
      case "expulser": {
        const target = interaction.options.getMember("membre");
        await respond(
          target
            ? await kickFromVoice(voice, row, target)
            : { ok: false, message: "Ce membre n'est pas dans ton vocal." },
        );
        return;
      }
      case "transferer": {
        const target = interaction.options.getMember("membre");
        await respond(
          target
            ? await transferVoice(voice, row, target)
            : { ok: false, message: "Le nouveau propriétaire doit être dans ton vocal." },
        );
        return;
      }
    }
  },
};

export default voc;
