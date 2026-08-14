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
import type { CloverClient } from "../../client";
import {
  env,
  luckPermsConfigured,
  siteApiConfigured,
  voteEndpointConfigured,
} from "../../config";
import { db } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botInviteTiers, botLevelRoles, botRankRoles } from "../../db/schema";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { getMcStatus } from "../../lib/mc-status";
import {
  buildApplicationPanel,
  refreshApplicationPanels,
} from "../../modules/applications/manager";
import { getInviteTiers } from "../../modules/invites/rewards";
import { getRankRoles } from "../../modules/ranks/sync";
import {
  getLogSettings,
  LOG_CATEGORIES,
  LOG_CATEGORY_KEYS,
  type LogCategory,
  setLogSetting,
} from "../../modules/logs/channel";
import { countHumanMembers } from "../../modules/member-counter/job";
import {
  DEFAULT_WELCOME_MESSAGE,
  WELCOME_PLACEHOLDERS,
  welcomeEmbed,
} from "../../modules/welcome/join";
import {
  getLeaveFeedbackStats,
  statsEmbed,
  surveyEmbed,
} from "../../modules/welcome/leave";
import type { Command } from "../../types";

/** Choix proposés dans les options `categorie` du groupe `logs`. */
const LOG_CATEGORY_CHOICES = LOG_CATEGORY_KEYS.map((key) => ({
  name: LOG_CATEGORIES[key],
  value: key,
}));

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
): Promise<VoiceChannel> {
  return interaction.guild.channels.create({
    name: name.slice(0, 100),
    type: ChannelType.GuildVoice,
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
            .setName("message")
            .setDescription("Message privé de passage de niveau ({user}, {level}, {server})")
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
            )
            .addStringOption((o) =>
              o
                .setName("commande")
                .setDescription("Récompense en jeu, ex. crate give {player} niveau 1"),
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
    // ── Accueil et départ ──
    .addSubcommandGroup((g) =>
      g
        .setName("accueil")
        .setDescription("Messages privés de bienvenue et sondage de départ")
        .addSubcommand((s) =>
          s
            .setName("bienvenue")
            .setDescription("Activer/désactiver le MP de bienvenue à l'arrivée")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Envoyer un MP de bienvenue").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("bienvenue-message")
            .setDescription(`Texte du MP de bienvenue (${WELCOME_PLACEHOLDERS})`)
            .addStringOption((o) =>
              o
                .setName("texte")
                .setDescription("Laisser vide pour revenir au message par défaut")
                .setMaxLength(1500),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("depart")
            .setDescription("Activer/désactiver le sondage privé « pourquoi es-tu parti ? »")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Envoyer le sondage au départ").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("depart-salon")
            .setDescription("Salon où publier les retours de départ (défaut : salon de logs)")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon des retours")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("retours")
            .setDescription("Statistiques des raisons de départ")
            .addIntegerOption((o) =>
              o
                .setName("jours")
                .setDescription("Période analysée (30 par défaut)")
                .setMinValue(1)
                .setMaxValue(365),
            ),
        )
        .addSubcommand((s) =>
          s.setName("apercu").setDescription("Prévisualiser les deux messages privés"),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher la configuration de l'accueil"),
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
        .setDescription("Journal des événements du serveur")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon de logs (par défaut, ou dédié à une catégorie)")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon de logs")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            )
            .addStringOption((o) =>
              o
                .setName("categorie")
                .setDescription("Limiter ce salon à une catégorie (sinon : salon par défaut)")
                .addChoices(...LOG_CATEGORY_CHOICES),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("categorie")
            .setDescription("Activer ou désactiver une catégorie de logs")
            .addStringOption((o) =>
              o
                .setName("categorie")
                .setDescription("Catégorie concernée")
                .setRequired(true)
                .addChoices(...LOG_CATEGORY_CHOICES),
            )
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Journaliser cette catégorie").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher la configuration des logs"),
        ),
    )
    // ── Modération ──
    .addSubcommandGroup((g) =>
      g
        .setName("moderation")
        .setDescription("Sanctions et propagation en jeu")
        .addSubcommand((s) =>
          s
            .setName("role-muet")
            .setDescription("Rôle appliqué quand le timeout Discord ne suffit pas")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle muet").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("propagation")
            .setDescription("Répercuter les sanctions sur les serveurs Minecraft")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Activer").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("commande")
            .setDescription("Commande console utilisée pour une action")
            .addStringOption((o) =>
              o
                .setName("action")
                .setDescription("Action concernée")
                .setRequired(true)
                .addChoices(
                  { name: "Bannir", value: "ban" },
                  { name: "Débannir", value: "unban" },
                  { name: "Expulser", value: "kick" },
                  { name: "Muter", value: "mute" },
                  { name: "Démuter", value: "unmute" },
                ),
            )
            .addStringOption((o) =>
              o
                .setName("commande")
                .setDescription("Ex. tempban {player} {duration} {reason}")
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher la configuration de modération"),
        ),
    )
    // ── Grades Minecraft ──
    .addSubcommandGroup((g) =>
      g
        .setName("grades")
        .setDescription("Grades LuckPerms reflétés en rôles Discord")
        .addSubcommand((s) =>
          s
            .setName("actif")
            .setDescription("Activer la synchronisation des grades")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Activer").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("lier")
            .setDescription("Associer un groupe LuckPerms à un rôle Discord")
            .addStringOption((o) =>
              o
                .setName("groupe")
                .setDescription("Nom du groupe LuckPerms, ex. vip")
                .setRequired(true),
            )
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle Discord").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("delier")
            .setDescription("Retirer l'association d'un groupe")
            .addStringOption((o) =>
              o.setName("groupe").setDescription("Nom du groupe").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher les associations de grades"),
        ),
    )
    // ── Votes ──
    .addSubcommandGroup((g) =>
      g
        .setName("votes")
        .setDescription("Récompenses des votes sur les listes de serveurs")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon où annoncer les votes")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon d'annonce")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("role")
            .setDescription("Rôle temporaire donné au votant")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle « votant »").setRequired(true),
            )
            .addIntegerOption((o) =>
              o
                .setName("heures")
                .setDescription("Durée du rôle en heures (défaut : 24)")
                .setMinValue(1)
                .setMaxValue(720),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("commande")
            .setDescription("Commande console lancée à chaque vote")
            .addStringOption((o) =>
              o
                .setName("commande")
                .setDescription("Ex. crate give {player} vote 1 — vide pour désactiver")
                .setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher la configuration des votes"),
        ),
    )
    // ── Boosts ──
    .addSubcommandGroup((g) =>
      g
        .setName("boosts")
        .setDescription("Remerciement et récompense des boosts Nitro")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon où remercier les boosters")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon d'annonce")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("message")
            .setDescription("Message de remerciement : {user} {count} {server}")
            .addStringOption((o) =>
              o.setName("texte").setDescription("Message").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("commande")
            .setDescription("Commande console de récompense du boost")
            .addStringOption((o) =>
              o
                .setName("commande")
                .setDescription("Ex. crate give {player} booster 1")
                .setRequired(true),
            ),
        ),
    )
    // ── Suggestions ──
    .addSubcommandGroup((g) =>
      g
        .setName("suggestions")
        .setDescription("Salon des suggestions de la communauté")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon où publier les suggestions")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon des suggestions")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        ),
    )
    // ── Invitations ──
    .addSubcommandGroup((g) =>
      g
        .setName("invitations")
        .setDescription("Annonce et récompenses du parrainage")
        .addSubcommand((s) =>
          s
            .setName("salon")
            .setDescription("Salon où annoncer qui invite qui")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon d'annonce")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("recompenses")
            .setDescription("XP et crédits versés par invitation validée")
            .addIntegerOption((o) =>
              o
                .setName("xp")
                .setDescription("XP par invitation (0 pour désactiver)")
                .setMinValue(0)
                .setMaxValue(10_000),
            )
            .addIntegerOption((o) =>
              o
                .setName("credits")
                .setDescription("Crédits par invitation (1 crédit = 0,01 €)")
                .setMinValue(0)
                .setMaxValue(500),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("conditions")
            .setDescription("Garde-fous anti multi-comptes")
            .addIntegerOption((o) =>
              o
                .setName("maturation")
                .setDescription("Jours d'attente avant récompense")
                .setMinValue(0)
                .setMaxValue(90),
            )
            .addIntegerOption((o) =>
              o
                .setName("age-compte")
                .setDescription("Âge minimal du compte du filleul, en jours")
                .setMinValue(0)
                .setMaxValue(365),
            )
            .addIntegerOption((o) =>
              o
                .setName("niveau")
                .setDescription("Niveau minimal sans compte lié (0 = lien obligatoire)")
                .setMinValue(0)
                .setMaxValue(100),
            )
            .addIntegerOption((o) =>
              o
                .setName("plafond")
                .setDescription("Invitations validées par parrain et par mois")
                .setMinValue(1)
                .setMaxValue(1_000),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("palier")
            .setDescription("Bonus en crédits à partir de N invitations")
            .addIntegerOption((o) =>
              o
                .setName("nombre")
                .setDescription("Nombre d'invitations validées")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10_000),
            )
            .addIntegerOption((o) =>
              o
                .setName("credits")
                .setDescription("Crédits versés une fois (0 pour supprimer le palier)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(5_000),
            ),
        )
        .addSubcommand((s) =>
          s.setName("voir").setDescription("Afficher la configuration du parrainage"),
        ),
    )
    // ── Candidatures ──
    .addSubcommandGroup((g) =>
      g
        .setName("candidatures")
        .setDescription("Recrutement du staff")
        .addSubcommand((s) =>
          s
            .setName("panneau")
            .setDescription("Publier le panneau de candidature")
            .addChannelOption((o) =>
              o
                .setName("salon")
                .setDescription("Salon du panneau")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("categorie")
            .setDescription("Catégorie où créer les salons de candidature")
            .addChannelOption((o) =>
              o
                .setName("categorie")
                .setDescription("Catégorie des candidatures")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildCategory),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("role")
            .setDescription("Rôle des responsables, seuls à voir les candidatures")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Rôle des responsables du recrutement").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("archives")
            .setDescription("Salon où archiver les candidatures traitées")
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
            .setName("ouvrir")
            .setDescription("Ouvrir ou fermer les candidatures")
            .addBooleanOption((o) =>
              o.setName("actif").setDescription("Candidatures ouvertes").setRequired(true),
            ),
        ),
    ),
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(true);
    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    switch (`${group}/${sub}`) {
      // ── Niveaux ──
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
          `XP par message : **${min}–${max}**, anti-spam : **${cooldown}s**.`,
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
        const rconCommand = interaction.options.getString("commande")?.trim() || null;
        await db
          .insert(botLevelRoles)
          .values({ guildId, level, roleId: role.id, rconCommand })
          .onConflictDoUpdate({
            target: [botLevelRoles.guildId, botLevelRoles.level],
            set: { roleId: role.id, rconCommand },
          });
        await reply(
          interaction,
          rconCommand
            ? `Le rôle ${role} sera donné au niveau **${level}**, avec \`${rconCommand}\` en jeu.`
            : `Le rôle ${role} sera donné au niveau **${level}**.`,
        );
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

      // ── Accueil et départ ──
      case "accueil/bienvenue": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { welcomeDmEnabled: actif });
        await reply(
          interaction,
          actif
            ? "MP de bienvenue **activé** — aperçu avec `/config accueil apercu`."
            : "MP de bienvenue **désactivé**.",
        );
        return;
      }
      case "accueil/bienvenue-message": {
        const texte = interaction.options.getString("texte");
        await updateGuildConfig(guildId, { welcomeDmMessage: texte ?? null });
        await reply(
          interaction,
          texte
            ? "Message de bienvenue mis à jour — aperçu avec `/config accueil apercu`."
            : "Message de bienvenue réinitialisé (texte par défaut).",
        );
        return;
      }
      case "accueil/depart": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { leaveSurveyEnabled: actif });
        await reply(
          interaction,
          actif
            ? "Sondage de départ **activé** — les membres bannis ou expulsés en sont exclus."
            : "Sondage de départ **désactivé**.",
        );
        return;
      }
      case "accueil/depart-salon": {
        const channel = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { leaveFeedbackChannelId: channel.id });
        await reply(interaction, `Retours de départ publiés dans ${channel}.`);
        return;
      }
      case "accueil/retours": {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const jours = interaction.options.getInteger("jours") ?? 30;
        const stats = await getLeaveFeedbackStats(guildId, jours);
        await interaction.editReply({ embeds: [statsEmbed(stats, jours)] });
        return;
      }
      case "accueil/apercu": {
        const cfg = await getGuildConfig(guildId);
        await interaction.reply({
          embeds: [
            welcomeEmbed(
              interaction.guild,
              interaction.user.id,
              cfg.welcomeDmMessage ?? DEFAULT_WELCOME_MESSAGE,
            ),
            surveyEmbed(interaction.guild),
          ],
          // Les boutons et le menu sont volontairement omis : ils n'existent
          // que dans le vrai MP, rattachés à un départ précis.
          content:
            "-# Aperçu des deux messages privés (les boutons ne sont pas reproduits ici).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      case "accueil/voir": {
        const cfg = await getGuildConfig(guildId);
        const feedbackChannel = cfg.leaveFeedbackChannelId ?? cfg.logChannelId;
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("👋 Accueil et départ")
              .setDescription(
                [
                  `${cfg.welcomeDmEnabled ? "✅" : "❌"} **MP de bienvenue** — ${
                    cfg.welcomeDmEnabled ? "activé" : "désactivé"
                  }`,
                  `> Message ${cfg.welcomeDmMessage ? "personnalisé" : "par défaut"} · variables : \`${WELCOME_PLACEHOLDERS}\``,
                  "",
                  `${cfg.leaveSurveyEnabled ? "✅" : "❌"} **Sondage de départ** — ${
                    cfg.leaveSurveyEnabled ? "activé" : "désactivé"
                  }`,
                  `> Retours publiés dans ${
                    feedbackChannel ? `<#${feedbackChannel}>` : "*aucun salon configuré*"
                  }${cfg.leaveFeedbackChannelId ? "" : " *(salon de logs par défaut)*"}`,
                ].join("\n"),
              )
              .setFooter({
                text: "Discord n'autorise le MP de départ que si une conversation privée existe déjà — le MP de bienvenue l'ouvre.",
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
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
        const channel = await createCounterChannel(interaction, name);
        await updateGuildConfig(guildId, { counterChannelId: channel.id });
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Compteur de joueurs créé : ${channel} (actualisé toutes les 6min).`,
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
        );
        await updateGuildConfig(guildId, { memberCounterChannelId: channel.id });
        await interaction.editReply({
          embeds: [
            successEmbed(
              `Compteur de membres créé : ${channel} — **${count}** membre(s), bots exclus (actualisé toutes les 6min).`,
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
        });
        const hub = await interaction.guild.channels.create({
          name: "➕ Créer ton vocal",
          type: ChannelType.GuildVoice,
          parent: category.id,
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
          `L'embed de statut sera publié dans ${channel} d'ici 60s, puis actualisé en continu.`,
        );
        return;
      }

      // ── Logs ──
      case "logs/salon": {
        const channel = interaction.options.getChannel("salon", true);
        const category = interaction.options.getString("categorie") as LogCategory | null;
        if (category) {
          await setLogSetting(guildId, category, {
            channelId: channel.id,
            enabled: true,
          });
          await reply(
            interaction,
            `Logs **${LOG_CATEGORIES[category]}** dans ${channel}.`,
          );
          return;
        }
        await updateGuildConfig(guildId, { logChannelId: channel.id });
        await reply(
          interaction,
          `Salon de logs par défaut : ${channel} — utilisé par toutes les catégories sans salon dédié.`,
        );
        return;
      }
      case "logs/categorie": {
        const category = interaction.options.getString("categorie", true) as LogCategory;
        const actif = interaction.options.getBoolean("actif", true);
        await setLogSetting(guildId, category, { enabled: actif });
        await reply(
          interaction,
          `Logs **${LOG_CATEGORIES[category]}** ${actif ? "activés" : "désactivés"}.`,
        );
        return;
      }
      case "logs/voir": {
        const cfg = await getGuildConfig(guildId);
        const settings = await getLogSettings(guildId);
        const lines = LOG_CATEGORY_KEYS.map((key) => {
          const setting = settings.find((s) => s.category === key);
          if (setting && !setting.enabled) {
            return `❌ **${LOG_CATEGORIES[key]}** — désactivé`;
          }
          const channelId = setting?.channelId ?? cfg.logChannelId;
          return `✅ **${LOG_CATEGORIES[key]}** — ${
            channelId ? `<#${channelId}>` : "*aucun salon configuré*"
          }`;
        });
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("📋 Configuration des logs")
              .setDescription(
                `**Salon par défaut** ${
                  cfg.logChannelId ? `<#${cfg.logChannelId}>` : "*non défini*"
                }\n\n${lines.join("\n")}`,
              )
              .setFooter({
                text: "L'auteur des sanctions et suppressions nécessite la permission « Voir les logs d'audit ».",
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Modération ──
      case "moderation/role-muet": {
        const role = interaction.options.getRole("role", true);
        await updateGuildConfig(guildId, { muteRoleId: role.id });
        await reply(interaction, `Rôle muet : ${role}.`);
        return;
      }
      case "moderation/propagation": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { sanctionPropagateMc: actif });
        await reply(
          interaction,
          actif
            ? "Les sanctions seront répercutées en jeu sur les comptes liés."
            : "Les sanctions ne seront plus répercutées en jeu.",
        );
        return;
      }
      case "moderation/commande": {
        const action = interaction.options.getString("action", true);
        const commande = interaction.options.getString("commande", true);
        const column = {
          ban: "mcBanCommand",
          unban: "mcUnbanCommand",
          kick: "mcKickCommand",
          mute: "mcMuteCommand",
          unmute: "mcUnmuteCommand",
        }[action];
        if (!column) return;
        await updateGuildConfig(guildId, { [column]: commande });
        await reply(interaction, `Commande **${action}** : \`${commande}\`.`);
        return;
      }
      case "moderation/voir": {
        const cfg = await getGuildConfig(guildId);
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("🔨 Configuration de modération")
              .setDescription(
                [
                  `**Rôle muet** ${cfg.muteRoleId ? `<@&${cfg.muteRoleId}>` : "*non défini* (timeout Discord seul)"}`,
                  `**Propagation en jeu** ${cfg.sanctionPropagateMc ? "✅ activée" : "❌ désactivée"}`,
                  "",
                  `\`ban\` → \`${cfg.mcBanCommand}\``,
                  `\`unban\` → \`${cfg.mcUnbanCommand}\``,
                  `\`kick\` → \`${cfg.mcKickCommand}\``,
                  `\`mute\` → \`${cfg.mcMuteCommand}\``,
                  `\`unmute\` → \`${cfg.mcUnmuteCommand}\``,
                ].join("\n"),
              )
              .setFooter({
                text: "Variables : {player} {reason} {duration}. Commandes diffusées à tous les serveurs dont le RCON est configuré.",
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Grades Minecraft ──
      case "grades/actif": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { rankSyncEnabled: actif });
        await reply(
          interaction,
          actif
            ? "Synchronisation des grades activée (nécessite `LUCKPERMS_DB_*` dans le `.env`)."
            : "Synchronisation des grades désactivée.",
        );
        return;
      }
      case "grades/lier": {
        const group = interaction.options.getString("groupe", true).toLowerCase();
        const role = interaction.options.getRole("role", true);
        await db
          .insert(botRankRoles)
          .values({ guildId, lpGroup: group, roleId: role.id })
          .onConflictDoUpdate({
            target: [botRankRoles.guildId, botRankRoles.lpGroup],
            set: { roleId: role.id },
          });
        await reply(interaction, `Le grade \`${group}\` donnera le rôle ${role}.`);
        return;
      }
      case "grades/delier": {
        const group = interaction.options.getString("groupe", true).toLowerCase();
        await db
          .delete(botRankRoles)
          .where(
            and(eq(botRankRoles.guildId, guildId), eq(botRankRoles.lpGroup, group)),
          );
        await reply(interaction, `Association du grade \`${group}\` supprimée.`);
        return;
      }
      case "grades/voir": {
        const cfg = await getGuildConfig(guildId);
        const rows = await getRankRoles(guildId);
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("🏅 Grades Minecraft → rôles Discord")
              .setDescription(
                [
                  `**Synchronisation** ${cfg.rankSyncEnabled ? "✅ activée" : "❌ désactivée"}`,
                  `**Base LuckPerms** ${luckPermsConfigured ? "✅ configurée" : "❌ absente du `.env`"}`,
                  "",
                  rows.length
                    ? rows.map((r) => `\`${r.lpGroup}\` → <@&${r.roleId}>`).join("\n")
                    : "*Aucune association définie.*",
                ].join("\n"),
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Votes ──
      case "votes/salon": {
        const salon = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { voteChannelId: salon.id });
        await reply(interaction, `Les votes seront annoncés dans <#${salon.id}>.`);
        return;
      }
      case "votes/role": {
        const role = interaction.options.getRole("role", true);
        const heures = interaction.options.getInteger("heures") ?? 24;
        await updateGuildConfig(guildId, {
          voteRoleId: role.id,
          voteRoleHours: heures,
        });
        await reply(
          interaction,
          `Le rôle ${role} sera donné **${heures}h** après chaque vote.`,
        );
        return;
      }
      case "votes/commande": {
        const commande = interaction.options.getString("commande", true).trim();
        await updateGuildConfig(guildId, { voteRconCommand: commande || null });
        await reply(
          interaction,
          commande
            ? `Récompense de vote : \`${commande}\`.`
            : "Récompense de vote désactivée.",
        );
        return;
      }
      case "votes/voir": {
        const cfg = await getGuildConfig(guildId);
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("🗳️ Configuration des votes")
              .setDescription(
                [
                  `**Endpoint** ${voteEndpointConfigured ? `✅ port \`${env.VOTE_HTTP_PORT}\`, chemin \`/vote\`` : "❌ `VOTE_HTTP_PORT` et `VOTE_TOKEN` absents du `.env`"}`,
                  `**Salon d'annonce** ${cfg.voteChannelId ? `<#${cfg.voteChannelId}>` : "*non défini*"}`,
                  `**Rôle temporaire** ${cfg.voteRoleId ? `<@&${cfg.voteRoleId}> pendant ${cfg.voteRoleHours}h` : "*non défini*"}`,
                  `**Récompense** ${cfg.voteRconCommand ? `\`${cfg.voteRconCommand}\`` : "*aucune*"}`,
                ].join("\n"),
              )
              .setFooter({
                text: "Les listes de serveurs doivent appeler /vote avec le jeton VOTE_TOKEN.",
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Boosts ──
      case "boosts/salon": {
        const salon = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { boostChannelId: salon.id });
        await reply(interaction, `Les boosts seront remerciés dans <#${salon.id}>.`);
        return;
      }
      case "boosts/message": {
        await updateGuildConfig(guildId, {
          boostMessage: interaction.options.getString("texte", true),
        });
        await reply(interaction, "Message de remerciement mis à jour.");
        return;
      }
      case "boosts/commande": {
        const commande = interaction.options.getString("commande", true).trim();
        await updateGuildConfig(guildId, { boostRconCommand: commande || null });
        await reply(
          interaction,
          commande
            ? `Récompense de boost : \`${commande}\`.`
            : "Récompense de boost désactivée.",
        );
        return;
      }

      // ── Suggestions ──
      case "suggestions/salon": {
        const salon = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { suggestionChannelId: salon.id });
        await reply(
          interaction,
          `Les suggestions seront publiées dans <#${salon.id}> (commande \`/suggestion\`).`,
        );
        return;
      }

      // ── Invitations ──
      case "invitations/salon": {
        const salon = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { inviteChannelId: salon.id });
        await reply(interaction, `Les invitations seront annoncées dans <#${salon.id}>.`);
        return;
      }
      case "invitations/recompenses": {
        const xp = interaction.options.getInteger("xp");
        const credits = interaction.options.getInteger("credits");
        if (xp === null && credits === null) {
          await interaction.reply({
            embeds: [errorEmbed("Précise au moins `xp` ou `credits`.")],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await updateGuildConfig(guildId, {
          inviteXp: xp ?? undefined,
          inviteCredits: credits ?? undefined,
        });
        await reply(
          interaction,
          [
            xp !== null ? `XP par invitation : **${xp}**.` : null,
            credits !== null
              ? `Crédits par invitation : **${credits}** _(${(credits / 100).toFixed(2)} € de valeur boutique)_.`
              : null,
            credits && !siteApiConfigured
              ? "⚠️ `SITE_API_URL`/`SITE_API_TOKEN` absents du `.env` : aucun crédit ne sera versé."
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }
      case "invitations/conditions": {
        const maturation = interaction.options.getInteger("maturation");
        const age = interaction.options.getInteger("age-compte");
        const niveau = interaction.options.getInteger("niveau");
        const plafond = interaction.options.getInteger("plafond");
        await updateGuildConfig(guildId, {
          inviteMaturityDays: maturation ?? undefined,
          inviteMinAccountAgeDays: age ?? undefined,
          inviteMinLevel: niveau ?? undefined,
          inviteRequireLink: niveau === 0 ? true : undefined,
          inviteMonthlyCap: plafond ?? undefined,
        });
        await reply(interaction, "Conditions de validation mises à jour.");
        return;
      }
      case "invitations/palier": {
        const threshold = interaction.options.getInteger("nombre", true);
        const credits = interaction.options.getInteger("credits", true);
        if (credits === 0) {
          await db
            .delete(botInviteTiers)
            .where(
              and(
                eq(botInviteTiers.guildId, guildId),
                eq(botInviteTiers.threshold, threshold),
              ),
            );
          await reply(interaction, `Palier de **${threshold}** invitations supprimé.`);
          return;
        }
        await db
          .insert(botInviteTiers)
          .values({ guildId, threshold, credits })
          .onConflictDoUpdate({
            target: [botInviteTiers.guildId, botInviteTiers.threshold],
            set: { credits },
          });
        await reply(
          interaction,
          `Palier : **${credits}** crédits à **${threshold}** invitations validées.`,
        );
        return;
      }
      case "invitations/voir": {
        const cfg = await getGuildConfig(guildId);
        const tiers = await getInviteTiers(guildId);
        await interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle("📨 Configuration du parrainage")
              .setDescription(
                [
                  `**Salon d'annonce** ${cfg.inviteChannelId ? `<#${cfg.inviteChannelId}>` : "*non défini*"}`,
                  `**XP par invitation** ${cfg.inviteXp || "désactivée"}`,
                  `**Crédits par invitation** ${cfg.inviteCredits || "désactivés"}${
                    cfg.inviteCredits && !siteApiConfigured
                      ? " ⚠️ site non configuré"
                      : ""
                  }`,
                  "",
                  "**Conditions de validation**",
                  `· maturation : **${cfg.inviteMaturityDays}** jour(s)`,
                  `· âge du compte du filleul : **${cfg.inviteMinAccountAgeDays}** jour(s)`,
                  `· preuve d'activité : compte lié${cfg.inviteMinLevel > 0 ? ` ou niveau ${cfg.inviteMinLevel}` : " (obligatoire)"}`,
                  `· plafond mensuel : **${cfg.inviteMonthlyCap}** par parrain`,
                  "",
                  "**Paliers**",
                  tiers.length
                    ? tiers
                        .map((t) => `· ${t.threshold} invitations → **${t.credits}** crédits`)
                        .join("\n")
                    : "*aucun palier défini*",
                ].join("\n"),
              )
              .setFooter({
                text: "Référence : 100 crédits = 1,00 € · le jeu rapporte 1 crédit par heure active.",
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // ── Candidatures ──
      case "candidatures/panneau": {
        const salon = interaction.options.getChannel("salon", true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await getGuildConfig(guildId);
        const channel = await interaction.guild.channels
          .fetch(salon.id)
          .catch(() => null);
        if (!channel?.isSendable()) {
          await interaction.editReply({
            embeds: [errorEmbed("Je ne peux pas écrire dans ce salon.")],
          });
          return;
        }
        const message = await channel.send(
          buildApplicationPanel(cfg.applicationsOpen),
        );
        await updateGuildConfig(guildId, {
          applicationPanelChannelId: salon.id,
          applicationPanelMessageId: message.id,
        });
        await interaction.editReply({
          embeds: [successEmbed(`Panneau de candidature publié dans <#${salon.id}>.`)],
        });
        return;
      }
      case "candidatures/categorie": {
        const categorie = interaction.options.getChannel("categorie", true);
        await updateGuildConfig(guildId, { applicationCategoryId: categorie.id });
        await reply(
          interaction,
          `Les salons de candidature seront créés dans **${categorie.name}**.`,
        );
        return;
      }
      case "candidatures/role": {
        const role = interaction.options.getRole("role", true);
        await updateGuildConfig(guildId, { applicationRoleId: role.id });
        await reply(
          interaction,
          `${role} verra les salons de candidature et pourra décider.`,
        );
        return;
      }
      case "candidatures/archives": {
        const salon = interaction.options.getChannel("salon", true);
        await updateGuildConfig(guildId, { applicationReviewChannelId: salon.id });
        await reply(
          interaction,
          `Les candidatures traitées seront archivées dans <#${salon.id}> (transcript compris).`,
        );
        return;
      }
      case "candidatures/ouvrir": {
        const actif = interaction.options.getBoolean("actif", true);
        await updateGuildConfig(guildId, { applicationsOpen: actif });
        await refreshApplicationPanels(interaction.client as CloverClient);
        await reply(
          interaction,
          actif ? "Candidatures **ouvertes**." : "Candidatures **fermées**.",
        );
        return;
      }
    }
  },
};

export default config;
