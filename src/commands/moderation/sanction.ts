import {
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type User,
} from "discord.js";
import { parseDuration } from "../../lib/duration";
import { brandEmbed, errorEmbed } from "../../lib/embeds";
import {
  applySanction,
  getSanction,
  revokeSanction,
  type SanctionType,
  sanctionEmbed,
} from "../../modules/moderation/sanctions";
import type { Command } from "../../types";

/**
 * Garde-fous hiérarchiques : Discord refuserait de toute façon l'action, mais
 * un message clair vaut mieux qu'un « permissions ? » après coup — et la
 * sanction ne doit surtout pas être historisée si elle ne peut pas s'appliquer.
 */
async function refuseTarget(
  interaction: ChatInputCommandInteraction<"cached">,
  target: User,
): Promise<string | null> {
  if (target.id === interaction.user.id) return "Tu ne peux pas te sanctionner toi-même.";
  if (target.id === interaction.client.user?.id) return "Je ne peux pas me sanctionner.";
  if (target.id === interaction.guild.ownerId)
    return "Le propriétaire du serveur ne peut pas être sanctionné.";

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return null; // plus sur le serveur : le bannissement reste possible

  if (
    member.roles.highest.position >= interaction.member.roles.highest.position &&
    interaction.user.id !== interaction.guild.ownerId
  ) {
    return "Ce membre a un rôle supérieur ou égal au tien.";
  }
  const me = interaction.guild.members.me;
  if (me && member.roles.highest.position >= me.roles.highest.position) {
    return "Ce membre a un rôle supérieur au mien : je ne peux rien lui appliquer.";
  }
  return null;
}

const sanction: Command = {
  data: new SlashCommandBuilder()
    .setName("sanction")
    .setDescription("Sanctionner un membre (staff)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName("avertir")
        .setDescription("Avertir un membre")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre visé").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("raison").setDescription("Raison").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("muter")
        .setDescription("Réduire un membre au silence")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre visé").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("raison").setDescription("Raison").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("duree")
            .setDescription("Durée : 30m, 2h, 7j… (défaut : 1h)")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("expulser")
        .setDescription("Expulser un membre")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre visé").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("raison").setDescription("Raison").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("bannir")
        .setDescription("Bannir un membre")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre visé").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("raison").setDescription("Raison").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("duree").setDescription("Durée : 7j, 30j… (défaut : définitif)"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("lever")
        .setDescription("Lever une sanction encore active")
        .addIntegerOption((o) =>
          o
            .setName("numero")
            .setDescription("Numéro de la sanction (voir /casier)")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((o) => o.setName("raison").setDescription("Motif de la levée")),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === "lever") {
      const id = interaction.options.getInteger("numero", true);
      const reason = interaction.options.getString("raison") ?? "Non précisé";
      const row = await getSanction(id);

      if (!row || row.guildId !== interaction.guildId) {
        await interaction.editReply({
          embeds: [errorEmbed(`Aucune sanction **#${id}** sur ce serveur.`)],
        });
        return;
      }
      if (!row.active) {
        await interaction.editReply({
          embeds: [errorEmbed(`La sanction **#${id}** n'est plus active.`)],
        });
        return;
      }
      if (row.type === "BAN" && !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
        await interaction.editReply({
          embeds: [errorEmbed("Il faut la permission « Bannir des membres ».")],
        });
        return;
      }

      const failures = await revokeSanction(
        interaction.guild,
        row,
        interaction.user.id,
        reason,
      );
      await interaction.editReply({
        embeds: [
          brandEmbed().setDescription(
            [
              `✅ Sanction **#${id}** levée.`,
              ...failures.map((f) => `⚠️ ${f}`),
            ].join("\n"),
          ),
        ],
      });
      return;
    }

    const target = interaction.options.getUser("membre", true);
    const reason = interaction.options.getString("raison", true);

    if (sub === "bannir" && !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
      await interaction.editReply({
        embeds: [errorEmbed("Il faut la permission « Bannir des membres ».")],
      });
      return;
    }
    if (sub === "expulser" && !interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
      await interaction.editReply({
        embeds: [errorEmbed("Il faut la permission « Expulser des membres ».")],
      });
      return;
    }

    const refusal = await refuseTarget(interaction, target);
    if (refusal) {
      await interaction.editReply({ embeds: [errorEmbed(refusal)] });
      return;
    }

    const rawDuration = interaction.options.getString("duree");
    let durationMs: number | null = null;
    if (rawDuration) {
      durationMs = parseDuration(rawDuration);
      if (!durationMs) {
        await interaction.editReply({
          embeds: [
            errorEmbed("Durée invalide. Exemples : `30m`, `2h`, `7j`, `1h30m`."),
          ],
        });
        return;
      }
    } else if (sub === "muter") {
      durationMs = 3_600_000; // 1 h par défaut, plutôt qu'un silence sans fin
    }

    const type: SanctionType = {
      avertir: "WARN",
      muter: "MUTE",
      expulser: "KICK",
      bannir: "BAN",
    }[sub] as SanctionType;

    const result = await applySanction({
      guild: interaction.guild,
      target,
      moderator: interaction.user,
      type,
      reason,
      durationMs,
    });

    const notes: string[] = [];
    if (result.propagatedTo.length) {
      notes.push(
        `🎮 Répercuté en jeu sur \`${result.minecraftUsername}\` (${result.propagatedTo.join(", ")}).`,
      );
    } else if (result.minecraftUsername) {
      notes.push(
        `ℹ️ Compte lié \`${result.minecraftUsername}\`, mais aucune propagation (désactivée ou RCON absent).`,
      );
    }
    notes.push(...result.failures.map((f) => `⚠️ ${f}`));

    const embed = sanctionEmbed(result.sanction, target, interaction.user);
    if (notes.length) embed.setFooter({ text: notes.join(" · ").slice(0, 2048) });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default sanction;
