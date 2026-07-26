import {
  ChannelType,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type VoiceChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botLevelRoles } from "../../db/schema";
import { errorEmbed, successEmbed } from "../../lib/embeds";
import { getMcStatus } from "../../lib/mc-status";
import { countHumanMembers } from "../../modules/member-counter/job";
import type { Command } from "../../types";

async function reply(
  interaction: ChatInputCommandInteraction<"cached">,
  message: string,
): Promise<void> {
  await interaction.reply({
    embeds: [successEmbed(message)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Salon vocal verrouillé servant d'affichage (personne ne peut s'y connecter). */
async function createCounterChannel(
  interaction: ChatInputCommandInteraction<"cached">,
  name: string,
  reason: string,
): Promise<VoiceChannel> {
  return interaction.guild.channels.create({
    name: name.slice(0, 100),
    type: ChannelType.GuildVoice,
    reason,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.Connect],
      },
    ],
  });
}

const config: Command = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configuration du bot (admin)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // ── Niveaux ──
    .addSubcommandGroup((g) =>
      g
        .setName("niveaux")
        .setDescription("Configuration du système de niveaux")
        .addSubcommand((s) =>
          s
            .setName("salon-annonces")
            .setDescription("Salon des annonces de niveau (vide = salon du message)")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon d'annonces")
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("message")
            .setDescription("Message de passage de niveau ({user}, {level})")
            .addStringOption((o) =>
              o.setName("texte").setDescription("Modèle du message").setRequired(true).setMaxLength(500),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("xp")
            .setDescription("Réglages de l'XP par message")
            .addIntegerOption((o) =>
              o.setName("min").setDescription("XP minimum par message").setMinValue(1).setMaxValue(1000),
            )
            .addIntegerOption((o) =>
              o.setName("max").setDescription("XP maximum par message").setMinValue(1).setMaxValue(1000),
            )
            .addIntegerOption((o) =>
              o.setName("cooldown").setDescription("Anti-spam en secondes").setMinValue(0).setMaxValue(3600),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("xp-vocal")
            .setDescription("XP gagné par minute en vocal (0 = désactivé)")
            .addIntegerOption((o) =>
              o.setName("montant").setDescription("XP par minute").setRequired(true).setMinValue(0).setMaxValue(100),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("sans-xp-ajouter")
            .setDescription("Exclure un salon du gain d'XP")
            .addChannelOption((o) =>
              o.setName("salon").setDescription("Salon à exclure").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("sans-xp-retirer")
            .setDescription("Réactiver le gain d'XP dans un salon")
            .addChannelOption((o) =>
              o.setName("salon").setDescription("Salon à réactiver").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("recompense")
            .setDescription("Attribuer un rôle à un niveau")
            .addIntegerOption((o) =>
              o.setName("niveau").setDescription("Niveau requis").setRequired(true).setMinValue(1),
            )
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle récompense").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("recompense-retrait")
            .setDescription("Supprimer la récompense d'un niveau")
            .addIntegerOption((o) =>
              o.setName("niveau").setDescription("Niveau concerné").setRequired(true).setMinValue(1),
            ),
        ),
    )
    // ── Sync ──
    .addSubcommandGroup((g) =>
      g
        .setName("sync")
        .setDescription("Configuration de la synchronisation Minecraft")
        .addSubcommand((s) =>
          s
            .setName("role")
            .setDescription("Rôle donné aux comptes synchronisés")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle « Synchronisé »").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("pseudos")
            .setDescription("Activer/désactiver le renommage automatique")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Renommer avec le pseudo Minecraft").setRequired(true),
            ),
        ),
    )
    // ── Compteur ──
    .addSubcommandGroup((g) =>
      g
        .setName("compteur")
        .setDescription("Salons vocaux compteurs (joueurs Minecraft, membres Discord)")
        .addSubcommand((s) =>
          s
            .setName("joueurs-creer")
            .setDescription("Créer le salon compteur de joueurs Minecraft (verrouillé)"),
        )
        .addSubcommand((s) =>
          s
            .setName("joueurs-salon")
            .setDescription("Utiliser un salon vocal existant comme compteur de joueurs")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon vocal")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("joueurs-modele")
            .setDescription("Modèle du nom du compteur de joueurs ({count}, {max})")
            .addStringOption((o) =>
              o.setName("texte").setDescription("Ex. 🎮 En ligne : {count}").setRequired(true).setMaxLength(90),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("membres-creer")
            .setDescription("Créer le salon compteur de membres Discord (verrouillé)"),
        )
        .addSubcommand((s) =>
          s
            .setName("membres-salon")
            .setDescription("Utiliser un salon vocal existant comme compteur de membres")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon vocal")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("membres-modele")
            .setDescription("Modèle du nom du compteur de membres ({count})")
            .addStringOption((o) =>
              o.setName("texte").setDescription("Ex. 👥 Membres : {count}").setRequired(true).setMaxLength(90),
            ),
        ),
    )
    // ── Tickets ──
    .addSubcommandGroup((g) =>
      g
        .setName("tickets")
        .setDescription("Configuration du système de tickets")
        .addSubcommand((s) =>
          s
            .setName("categorie")
            .setDescription("Catégorie où créer les salons tickets")
            .addChannelOption((o) =>
              o
                .setName("categorie")
                .setDescription("Catégorie")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildCategory),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("archive")
            .setDescription("Salon des archives de tickets (staff)")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon d'archives")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("role-support")
            .setDescription("Rôle de l'équipe support")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle support").setRequired(true),
            ),
        ),
    )
    // ── Vocaux temporaires ──
    .addSubcommandGroup((g) =>
      g
        .setName("tempvoice")
        .setDescription("Configuration des vocaux temporaires")
        .addSubcommand((s) =>
          s
            .setName("creer")
            .setDescription("Créer la catégorie « Vocaux » et le salon « Créer ton vocal »"),
        )
        .addSubcommand((s) =>
          s
            .setName("hub")
            .setDescription("Utiliser un salon vocal existant comme hub")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon « Créer ton vocal »")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("categorie")
            .setDescription("Catégorie où créer les vocaux temporaires")
            .addChannelOption((o) =>
              o
                .setName("categorie")
                .setDescription("Catégorie")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildCategory),
            ),
        ),
    )
    // ── Statut ──
    .addSubcommandGroup((g) =>
      g
        .setName("statut")
        .setDescription("Configuration de l'embed de statut des services")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon de l'embed de statut (publié/actualisé automatiquement)")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon de statut")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        ),
    )
    // ── Logs ──
    .addSubcommandGroup((g) =>
      g
        .setName("logs")
        .setDescription("Salon des logs du bot")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Définir le salon de logs")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon de logs")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        ),
    ),
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(true);
    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    switch (`${group}/${sub}`) {
      // ── Niveaux ──
      case "niveaux/salon-annonces": {
        const channel = interaction.options.getChannel("salon");
        await updateGuildConfig(guildId, { levelupChannelId: channel?.id ?? null });
        await reply(
          interaction,
          channel
            ? `Annonces de niveau dans ${channel}.`
            : "Annonces de niveau dans le salon du message.",
        );
        return;
      }
      case "niveaux/message": {
        await updateGuildConfig(guildId, {
          levelupMessage: interaction.options.getString("texte", true),
        });
        await reply(interaction, "Message de niveau mis à jour.");
        return;
      }
      case "niveaux/xp": {
        const cfg = await getGuildConfig(guildId);
        const min = interaction.options.getInteger("min") ?? cfg.xpMin;
        const max = interaction.options.getInteger("max") ?? cfg.xpMax;
        const cooldown = interaction.options.getInteger("cooldown") ?? cfg.xpCooldownSec;
        if (min > max) {
          await interaction.reply({
            embeds: [errorEmbed("`min` doit être ≤ `max`.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await updateGuildConfig(guildId, {
          xpMin: min,
          xpMax: max,
          xpCooldownSec: cooldown,
        });
        await reply(
          interaction,
          `XP par message : **${min}–${max}**, anti-spam : **${cooldown} s**.`,
        );
        return;
      }
      case "niveaux/xp-vocal": {
        const montant = interaction.options.getInteger("montant", true);
        await updateGuildConfig(guildId, { voiceXpPerMin: montant });
        await reply(
          interaction,
          montant === 0
            ? "XP vocal désactivé."
            : `XP vocal : **${montant}**/minute.`,
        );
        return;
      }
      case "niveaux/sans-xp-ajouter": {
        const channel = interaction.options.getChannel("salon", true);
        const cfg = await getGuildConfig(guildId);
        if (!cfg.noXpChannelIds.includes(channel.id)) {
          await updateGuildConfig(guildId, {
            noXpChannelIds: [...cfg.noXpChannelIds, channel.id],
          });
        }
        await reply(interaction, `Plus d'XP dans ${channel}.`);
        return;
      }
      case "niveaux/sans-xp-retirer": {
        const channel = interaction.options.getChannel("salon", true);
        const cfg = await getGuildConfig(guildId);
        await updateGuildConfig(guildId, {
          noXpChannelIds: cfg.noXpChannelIds.filter((id) => id !== channel.id),
        });
        await reply(interaction, `XP réactivé dans ${channel}.`);
        return;
      }
      case "niveaux/recompense": {
        const level = interaction.options.getInteger("niveau", true);
        const role = interaction.options.getRole("role", true);
        await db
          .insert(botLevelRoles)
          .values({ guildId, level, roleId: role.id })
          .onConflictDoUpdate({
            target: [botLevelRoles.guildId, botLevelRoles.level],
            set: { roleId: role.id },
          });
        await reply(interaction, `Le rôle ${role} sera donné au niveau **${level}**.`);
        return;
      }
      case "niveaux/recompense-retrait": {
        const level = interaction.options.getInteger("niveau", true);
        await db
          .delete(botLevelRoles)
          .where(
            and(eq(botLevelRoles.guildId, guildId), eq(botLevelRoles.level, level)),
          );
        await reply(interaction, `Récompense du niveau **${level}** supprimée.`);
        return;
      }

      // ── Sync ──
      case "sync/role": {
        const role = interaction.options.getRole("role", true);
        await updateGuildConfig(guildId, { linkedRoleId: role.id });
        await reply(interaction, `Rôle des comptes synchronisés : ${role}.`);
        return;
      }
      case "sync/pseudos": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { syncNicknames: actif });
        await reply(
          interaction,
          actif
            ? "Renommage automatique **activé** (pseudo = pseudo Minecraft)."
            : "Renommage automatique **désactivé**.",
        );
        return;
      }

      // ── Compteurs ──
      case "compteur/joueurs-creer": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await getGuildConfig(guildId);
        const status = await getMcStatus();
        const name = status.online
          ? cfg.counterTemplate
              .replaceAll("{count}", String(status.players))
              .replaceAll("{max}", String(status.maxPlayers))
          : "🔴 Serveur hors ligne";
        const channel = await createCounterChannel(
          interaction,
          name,
          "Salon compteur de joueurs Minecraft",
        );
        await updateGuildConfig(guildId, { counterChannelId: channel.id });
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Compteur de joueurs créé : ${channel} (actualisé toutes les 6 min).`,
            ),
          ],
        });
        return;
      }
      case "compteur/joueurs-salon": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { counterChannelId: channel.id });
        await reply(interaction, `Compteur de joueurs : ${channel}.`);
        return;
      }
      case "compteur/joueurs-modele": {
        await updateGuildConfig(guildId, {
          counterTemplate: interaction.options.getString("texte", true),
        });
        await reply(interaction, "Modèle du compteur de joueurs mis à jour.");
        return;
      }
      case "compteur/membres-creer": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await getGuildConfig(guildId);
        const count = await countHumanMembers(interaction.guild);
        const channel = await createCounterChannel(
          interaction,
          cfg.memberCounterTemplate.replaceAll("{count}", String(count)),
          "Salon compteur de membres Discord",
        );
        await updateGuildConfig(guildId, { memberCounterChannelId: channel.id });
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Compteur de membres créé : ${channel} — **${count}** membre(s), bots exclus (actualisé toutes les 6 min).`,
            ),
          ],
        });
        return;
      }
      case "compteur/membres-salon": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { memberCounterChannelId: channel.id });
        await reply(interaction, `Compteur de membres : ${channel}.`);
        return;
      }
      case "compteur/membres-modele": {
        await updateGuildConfig(guildId, {
          memberCounterTemplate: interaction.options.getString("texte", true),
        });
        await reply(interaction, "Modèle du compteur de membres mis à jour.");
        return;
      }

      // ── Tickets ──
      case "tickets/categorie": {
        const category = interaction.options.getChannel("categorie", true);
        await updateGuildConfig(guildId, { ticketCategoryId: category.id });
        await reply(interaction, `Les tickets seront créés dans **${category.name}**.`);
        return;
      }
      case "tickets/archive": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { ticketArchiveChannelId: channel.id });
        await reply(interaction, `Archives de tickets dans ${channel}.`);
        return;
      }
      case "tickets/role-support": {
        const role = interaction.options.getRole("role", true);
        await updateGuildConfig(guildId, { ticketSupportRoleId: role.id });
        await reply(interaction, `Rôle support : ${role}.`);
        return;
      }

      // ── Vocaux temporaires ──
      case "tempvoice/creer": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const category = await interaction.guild.channels.create({
          name: "🔊 Vocaux",
          type: ChannelType.GuildCategory,
          reason: "Catégorie des vocaux temporaires",
        });
        const hub = await interaction.guild.channels.create({
          name: "➕ Créer ton vocal",
          type: ChannelType.GuildVoice,
          parent: category.id,
          reason: "Hub des vocaux temporaires",
        });
        await updateGuildConfig(guildId, {
          tempvoiceCategoryId: category.id,
          tempvoiceHubId: hub.id,
        });
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Vocaux temporaires prêts : rejoins ${hub} pour créer ton vocal !`,
            ),
          ],
        });
        return;
      }
      case "tempvoice/hub": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { tempvoiceHubId: channel.id });
        await reply(interaction, `Hub des vocaux temporaires : ${channel}.`);
        return;
      }
      case "tempvoice/categorie": {
        const category = interaction.options.getChannel("categorie", true);
        await updateGuildConfig(guildId, { tempvoiceCategoryId: category.id });
        await reply(
          interaction,
          `Les vocaux temporaires seront créés dans **${category.name}**.`,
        );
        return;
      }

      // ── Statut ──
      case "statut/salon": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, {
          statusChannelId: channel.id,
          statusMessageId: null,
        });
        await reply(
          interaction,
          `L'embed de statut sera publié dans ${channel} d'ici 60 s, puis actualisé en continu.`,
        );
        return;
      }

      // ── Logs ──
      case "logs/salon": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { logChannelId: channel.id });
        await reply(interaction, `Salon de logs : ${channel}.`);
        return;
      }
    }
  },
};

export default config;
