import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { createBackup, deleteBackup, getBackup, listBackups } from "../../modules/security/backups";
import type { GuildSnapshot, MessagesSnapshot } from "../../modules/security/snapshot";
import { AUTHORITY_REFUSAL, hasSecurityAuthority } from "../../modules/security/trust";
import type { Command } from "../../types";

const sauvegarde: Command = {
  data: new SlashCommandBuilder()
    .setName("sauvegarde")
    .setDescription("Sauvegardes des rôles, salons, permissions et messages")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("creer")
        .setDescription("Sauvegarder le serveur maintenant")
        .addStringOption((o) => o.setName("nom").setDescription("Nom de la sauvegarde").setMaxLength(80)),
    )
    .addSubcommand((s) => s.setName("liste").setDescription("Dernières sauvegardes"))
    .addSubcommand((s) =>
      s
        .setName("voir")
        .setDescription("Contenu d'une sauvegarde")
        .addIntegerOption((o) => o.setName("id").setDescription("Numéro").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName("restaurer")
        .setDescription("Recréer le manquant et remettre l'existant à l'état sauvegardé")
        .addIntegerOption((o) => o.setName("id").setDescription("Numéro").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName("supprimer")
        .setDescription("Supprimer une sauvegarde")
        .addIntegerOption((o) => o.setName("id").setDescription("Numéro").setRequired(true).setMinValue(1)),
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand(true);
    // Une sauvegarde contient les derniers messages de chaque salon : même la
    // consultation est réservée à l'autorité de sécurité.
    if (!(await hasSecurityAuthority(guild, interaction.user.id))) {
      await interaction.reply({ embeds: [errorEmbed(AUTHORITY_REFUSAL)], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (sub) {
      case "creer": {
        const backup = await createBackup(guild, "manuel", interaction.user.id, interaction.options.getString("nom"));
        await interaction.editReply({ embeds: [successEmbed(`Sauvegarde **#${backup.id}** créée.`)] });
        return;
      }
      case "liste": {
        const rows = await listBackups(guild.id);
        const lines = rows.map((b) => {
          const at = Math.floor(b.createdAt.getTime() / 1_000);
          return `\`#${b.id}\` <t:${at}:f> · ${b.kind === "auto" ? "auto" : `manuelle${b.createdBy ? ` par <@${b.createdBy}>` : ""}`}${b.label ? ` — ${b.label}` : ""}`;
        });
        await interaction.editReply({
          embeds: [brandEmbed().setTitle("💾 Sauvegardes").setDescription(lines.join("\n") || "*Aucune sauvegarde.*")],
        });
        return;
      }
      case "voir": {
        const backup = await getBackup(guild.id, interaction.options.getInteger("id", true));
        if (!backup) {
          await interaction.editReply({ embeds: [errorEmbed("Sauvegarde introuvable.")] });
          return;
        }
        const data = backup.data as GuildSnapshot;
        const messages = backup.messages as MessagesSnapshot;
        const messageCount = Object.values(messages).reduce((n, list) => n + list.length, 0);
        await interaction.editReply({
          embeds: [
            brandEmbed()
              .setTitle(`💾 Sauvegarde #${backup.id}`)
              .setDescription(
                [
                  `**Date** <t:${Math.floor(backup.createdAt.getTime() / 1_000)}:f>`,
                  `**Rôles** ${data.roles.filter((r) => !r.managed).length}`,
                  `**Salons** ${data.channels.length}`,
                  `**Messages** ${messageCount} dans ${Object.keys(messages).length} salon(s)`,
                ].join("\n"),
              ),
          ],
        });
        return;
      }
      case "restaurer": {
        const id = interaction.options.getInteger("id", true);
        if (!(await getBackup(guild.id, id))) {
          await interaction.editReply({ embeds: [errorEmbed("Sauvegarde introuvable.")] });
          return;
        }
        await interaction.editReply({
          embeds: [
            brandEmbed()
              .setTitle(`⚠️ Restaurer la sauvegarde #${id} ?`)
              .setDescription(
                "Les rôles et salons disparus seront recréés (avec leurs derniers messages), et les rôles et salons existants remis à leurs noms et permissions sauvegardés. Rien de ce qui a été ajouté depuis n'est supprimé.",
              ),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(buildId("secu", "restore", id))
                .setLabel("Restaurer")
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(buildId("secu", "cancel"))
                .setLabel("Annuler")
                .setStyle(ButtonStyle.Secondary),
            ),
          ],
        });
        return;
      }
      case "supprimer": {
        const removed = await deleteBackup(guild.id, interaction.options.getInteger("id", true));
        await interaction.editReply({
          embeds: [removed ? successEmbed("Sauvegarde supprimée.") : errorEmbed("Sauvegarde introuvable.")],
        });
        return;
      }
    }
  },
};

export default sauvegarde;
