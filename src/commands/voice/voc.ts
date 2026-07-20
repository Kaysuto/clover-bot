import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type VoiceChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { botTempVoice } from "../../db/schema";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { getTempVoiceRow } from "../../modules/tempvoice/manager";
import type { Command } from "../../types";

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

    const reply = async (message: string) => {
      await interaction.reply({
        embeds: [successEmbed(message)],
        flags: MessageFlags.Ephemeral,
      });
    };

    // /voc claim : cas particulier — le demandeur n'est PAS le propriétaire
    if (sub === "claim") {
      if (row.ownerId === interaction.user.id) {
        await interaction.reply({
          embeds: [errorEmbed("Tu es déjà le propriétaire de ce vocal.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const ownerPresent = voice.members.has(row.ownerId);
      if (ownerPresent) {
        await interaction.reply({
          embeds: [errorEmbed("Le propriétaire est encore dans le vocal.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await transferOwnership(voice, row.textChannelId, row.ownerId, interaction.user.id);
      await reply("Tu es maintenant propriétaire de ce vocal ! 👑");
      return;
    }

    if (row.ownerId !== interaction.user.id) {
      await interaction.reply({
        embeds: [errorEmbed("Seul le propriétaire du vocal peut faire ça (`/voc claim` s'il est parti).")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (sub) {
      case "verrouiller": {
        await voice.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          Connect: false,
        });
        await db
          .update(botTempVoice)
          .set({ locked: true })
          .where(eq(botTempVoice.voiceChannelId, voice.id));
        await reply("Vocal verrouillé 🔒 — plus personne ne peut rejoindre.");
        return;
      }
      case "deverrouiller": {
        await voice.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          Connect: null,
        });
        await db
          .update(botTempVoice)
          .set({ locked: false })
          .where(eq(botTempVoice.voiceChannelId, voice.id));
        await reply("Vocal déverrouillé 🔓.");
        return;
      }
      case "limite": {
        const n = interaction.options.getInteger("nombre", true);
        await voice.setUserLimit(n);
        await db
          .update(botTempVoice)
          .set({ userLimit: n })
          .where(eq(botTempVoice.voiceChannelId, voice.id));
        await reply(n === 0 ? "Limite retirée (places illimitées)." : `Limite fixée à **${n}** place(s).`);
        return;
      }
      case "renommer": {
        const name = interaction.options.getString("nom", true);
        try {
          await voice.setName(`🔊 ${name}`.slice(0, 100));
          await reply(`Vocal renommé en **🔊 ${name}**.`);
        } catch {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Renommage impossible — Discord limite à 2 renommages par 10 minutes par salon.",
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }
      case "expulser": {
        const target = interaction.options.getMember("membre");
        if (!target || target.voice.channelId !== voice.id) {
          await interaction.reply({
            embeds: [errorEmbed("Ce membre n'est pas dans ton vocal.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (target.id === interaction.user.id) {
          await interaction.reply({
            embeds: [errorEmbed("Tu ne peux pas t'expulser toi-même.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await target.voice.disconnect("Expulsé par le propriétaire du vocal");
        await reply(`**${target.displayName}** a été expulsé du vocal.`);
        return;
      }
      case "transferer": {
        const target = interaction.options.getMember("membre");
        if (!target || target.voice.channelId !== voice.id) {
          await interaction.reply({
            embeds: [errorEmbed("Le nouveau propriétaire doit être dans ton vocal.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (target.user.bot || target.id === interaction.user.id) {
          await interaction.reply({
            embeds: [errorEmbed("Choisis un autre membre (humain) du vocal.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await transferOwnership(voice, row.textChannelId, row.ownerId, target.id);
        await reply(`👑 **${target.displayName}** est maintenant propriétaire du vocal.`);
        return;
      }
    }
  },
};

async function transferOwnership(
  voice: VoiceChannel,
  textChannelId: string,
  oldOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  await db
    .update(botTempVoice)
    .set({ ownerId: newOwnerId })
    .where(eq(botTempVoice.voiceChannelId, voice.id));

  await voice.permissionOverwrites.delete(oldOwnerId).catch(() => undefined);
  await voice.permissionOverwrites
    .edit(newOwnerId, {
      ViewChannel: true,
      Connect: true,
      MoveMembers: true,
    })
    .catch(() => undefined);

  const text = voice.guild.channels.cache.get(textChannelId);
  if (text && "permissionOverwrites" in text) {
    await text.permissionOverwrites
      .edit(newOwnerId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      })
      .catch(() => undefined);
  }
}

export default voc;
