import {
  ChannelType,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  type PermissionResolvable,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from "discord.js";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import {
  MODULE_IDS,
  PROTECTED_MODULES,
  SECURITY_MODULE_LABELS,
  type DashboardModule,
} from "../../modules/dashboard/modules";
import {
  createNetwork,
  getMembership,
  issueJoinCode,
  joinNetwork,
  leaveNetwork,
  networkGuilds,
  setShareBans,
} from "../../modules/network/manager";
import { approveBot, kickQuarantinedBot, pendingBots } from "../../modules/security/bot-quarantine";
import {
  getIncident,
  incidentLabel,
  recentIncidents,
  undoIncident,
} from "../../modules/security/incidents";
import { imageAnalysisConfigured } from "../../modules/security/nsfw";
import {
  configureWebhook,
  outboundAvailable,
  removeWebhook,
  testWebhook,
} from "../../modules/security/outbound";
import { hostOf } from "../../modules/security/phishing-detect";
import {
  AUTHORITY_REFUSAL,
  addTrusted,
  hasSecurityAuthority,
  listTrusted,
  removeTrusted,
} from "../../modules/security/trust";
import { activateVerification, deactivateVerification } from "../../modules/security/verification";
import type { Command } from "../../types";

type Interaction = ChatInputCommandInteraction<"cached">;

/** Permissions sans lesquelles une protection échoue au moment où elle sert. */
const REQUIRED_PERMISSIONS: Array<[PermissionResolvable, string]> = [
  [PermissionFlagsBits.ViewAuditLog, "Voir les logs d'audit"],
  [PermissionFlagsBits.ManageRoles, "Gérer les rôles"],
  [PermissionFlagsBits.ManageChannels, "Gérer les salons"],
  [PermissionFlagsBits.ManageWebhooks, "Gérer les webhooks"],
  [PermissionFlagsBits.ManageGuild, "Gérer le serveur"],
  [PermissionFlagsBits.ManageMessages, "Gérer les messages"],
  [PermissionFlagsBits.BanMembers, "Bannir des membres"],
  [PermissionFlagsBits.KickMembers, "Expulser des membres"],
  [PermissionFlagsBits.ModerateMembers, "Exclure temporairement"],
];

/** Sous-commandes de consultation, ouvertes à qui gère le serveur. */
const READ_ONLY = new Set(["statut", "incidents", "confiance/liste", "bot/attente", "reseau/voir"]);

const SECURITY_MODULES = MODULE_IDS.filter((id) => id in SECURITY_MODULE_LABELS);

async function ok(interaction: Interaction, message: string) {
  const payload = { embeds: [successEmbed(message)] };
  if (interaction.deferred) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function refuse(interaction: Interaction, message: string) {
  const payload = { embeds: [errorEmbed(message)] };
  if (interaction.deferred) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function show(interaction: Interaction, title: string, lines: string[]) {
  const payload = { embeds: [brandEmbed().setTitle(title).setDescription(lines.join("\n").slice(0, 4_000))] };
  if (interaction.deferred) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function int(name: string, description: string, min: number, max: number, required = false) {
  return (o: SlashCommandIntegerOption) =>
    o.setName(name).setDescription(description).setMinValue(min).setMaxValue(max).setRequired(required);
}

const data = new SlashCommandBuilder()
  .setName("securite")
  .setDescription("Protections du serveur")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName("statut").setDescription("État des protections et permissions du bot"))
  .addSubcommand((s) =>
    s
      .setName("role")
      .setDescription("Rôle de sécurité (propriétaire uniquement)")
      .addRoleOption((o) => o.setName("role").setDescription("Rôle — vide = aucun rôle de sécurité")),
  )
  .addSubcommand((s) =>
    s
      .setName("alertes")
      .setDescription("Salon des incidents de sécurité")
      .addChannelOption((o) =>
        o.setName("salon").setDescription("Salon — vide = logs « sécurité »").addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((s) => s.setName("incidents").setDescription("Derniers incidents de sécurité"))
  .addSubcommand((s) =>
    s
      .setName("annuler")
      .setDescription("Annuler les mesures d'un incident (rôles rendus, exclusions levées)")
      .addIntegerOption((o) => o.setName("incident").setDescription("Numéro de l'incident").setRequired(true).setMinValue(1)),
  )
  .addSubcommand((s) =>
    s
      .setName("module")
      .setDescription("Activer ou couper une protection")
      .addStringOption((o) =>
        o
          .setName("nom")
          .setDescription("Protection")
          .setRequired(true)
          .addChoices(...SECURITY_MODULES.map((id) => ({ name: SECURITY_MODULE_LABELS[id]!, value: id }))),
      )
      .addBooleanOption((o) => o.setName("actif").setDescription("Activée").setRequired(true)),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("confiance")
      .setDescription("Comptes que les protections ne sanctionnent pas")
      .addSubcommand((s) =>
        s
          .setName("ajouter")
          .setDescription("Ajouter un membre ou un bot de confiance")
          .addUserOption((o) => o.setName("compte").setDescription("Membre ou bot").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("retirer")
          .setDescription("Retirer un compte de confiance")
          .addUserOption((o) => o.setName("compte").setDescription("Membre ou bot").setRequired(true)),
      )
      .addSubcommand((s) => s.setName("liste").setDescription("Lister les comptes de confiance")),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("seuils")
      .setDescription("Réglages des protections")
      .addSubcommand((s) =>
        s
          .setName("antinuke")
          .setDescription("Actions en série tolérées avant sanction")
          .addIntegerOption(int("suppressions", "Salons/rôles supprimés (0 = ignoré)", 0, 50))
          .addIntegerOption(int("bannissements", "Bannissements/expulsions (0 = ignoré)", 0, 50))
          .addIntegerOption(int("creations", "Salons/rôles/webhooks créés (0 = ignoré)", 0, 100))
          .addIntegerOption(int("fenetre", "Fenêtre en secondes", 3, 120))
          .addBooleanOption((o) => o.setName("restaurer").setDescription("Recréer ce qui a été supprimé")),
      )
      .addSubcommand((s) =>
        s
          .setName("antispam")
          .setDescription("Seuils de l'anti-spam")
          .addIntegerOption(int("messages", "Messages tolérés dans la fenêtre (0 = ignoré)", 0, 50))
          .addIntegerOption(int("fenetre", "Fenêtre en secondes", 2, 60))
          .addIntegerOption(int("mentions", "Mentions par message (0 = ignoré)", 0, 50))
          .addIntegerOption(int("caracteres", "Longueur maximale d'un message", 200, 4000))
          .addIntegerOption(int("lignes", "Lignes maximales d'un message", 5, 200))
          .addIntegerOption(int("comptes-identiques", "Comptes postant le même texte (0 = ignoré)", 0, 20))
          .addIntegerOption(int("exclusion", "Exclusion temporaire de base, en minutes (0 = aucune)", 0, 1440)),
      )
      .addSubcommand((s) =>
        s
          .setName("phishing")
          .setDescription("Anti-phishing")
          .addIntegerOption(int("exclusion", "Exclusion temporaire, en minutes (0 = aucune)", 0, 10080, true)),
      )
      .addSubcommand((s) =>
        s
          .setName("nsfw")
          .setDescription("Filtre NSFW")
          .addIntegerOption(int("seuil", "Score d'image (0-100) au-delà duquel supprimer", 30, 100))
          .addBooleanOption((o) => o.setName("images").setDescription("Analyser les images")),
      )
      .addSubcommand((s) =>
        s
          .setName("surveillance")
          .setDescription("Surveillance du staff et anti-usurpation")
          .addIntegerOption(int("age-compte", "Âge minimal du compte pour un rôle sensible, en jours", 0, 365))
          .addIntegerOption(int("anciennete", "Ancienneté minimale sur le serveur, en jours", 0, 365))
          .addBooleanOption((o) =>
            o.setName("quarantaine-usurpateur").setDescription("Mettre en quarantaine (rôle anti-raid) un usurpateur"),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName("sauvegardes")
          .setDescription("Sauvegardes automatiques")
          .addIntegerOption(int("intervalle", "Heures entre deux sauvegardes (0 = désactivées)", 0, 168))
          .addIntegerOption(int("messages", "Derniers messages gardés par salon", 0, 100))
          .addIntegerOption(int("conservation", "Sauvegardes automatiques conservées", 1, 50)),
      )
      .addSubcommand((s) =>
        s
          .setName("verrouillage")
          .setDescription("Âge minimal des comptes pendant un verrouillage anti-raid")
          .addIntegerOption(int("jours", "Âge en jours (0 = règle permanente seule)", 0, 365, true)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("exemption")
      .setDescription("Exceptions de l'anti-spam et de l'anti-phishing")
      .addSubcommand((s) =>
        s
          .setName("salon-ajouter")
          .setDescription("Exempter un salon de l'anti-spam")
          .addChannelOption((o) => o.setName("salon").setDescription("Salon").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("salon-retirer")
          .setDescription("Soumettre de nouveau un salon à l'anti-spam")
          .addChannelOption((o) => o.setName("salon").setDescription("Salon").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("domaine-ajouter")
          .setDescription("Autoriser un domaine (et ses sous-domaines) malgré l'anti-phishing")
          .addStringOption((o) => o.setName("domaine").setDescription("ex. monsite.fr").setRequired(true).setMaxLength(120)),
      )
      .addSubcommand((s) =>
        s
          .setName("domaine-retirer")
          .setDescription("Retirer un domaine autorisé")
          .addStringOption((o) => o.setName("domaine").setDescription("Domaine").setRequired(true).setMaxLength(120)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("bot")
      .setDescription("Bots en quarantaine")
      .addSubcommand((s) => s.setName("attente").setDescription("Bots en attente de décision"))
      .addSubcommand((s) =>
        s
          .setName("autoriser")
          .setDescription("Rendre ses permissions à un bot")
          .addUserOption((o) => o.setName("bot").setDescription("Bot").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("expulser")
          .setDescription("Refuser et expulser un bot")
          .addUserOption((o) => o.setName("bot").setDescription("Bot").setRequired(true)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("verification")
      .setDescription("Vérification des arrivants")
      .addSubcommand((s) =>
        s
          .setName("activer")
          .setDescription("Masquer le serveur aux non-vérifiés (sauvegarde faite avant)")
          .addRoleOption((o) => o.setName("role").setDescription("Rôle « Vérifié »").setRequired(true))
          .addChannelOption((o) =>
            o
              .setName("salon")
              .setDescription("Salon de vérification, seul visible des arrivants")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("Bouton simple ou captcha image")
              .addChoices({ name: "Bouton", value: "bouton" }, { name: "Captcha image", value: "captcha" }),
          )
          .addIntegerOption(int("delai", "Expulser les non-vérifiés après X minutes (0 = jamais)", 0, 10080)),
      )
      .addSubcommand((s) => s.setName("desactiver").setDescription("Rendre le serveur visible à tous")),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("reseau")
      .setDescription("Réseau de serveurs : bannissements et journaux partagés")
      .addSubcommand((s) =>
        s
          .setName("creer")
          .setDescription("Créer un réseau à partir de ce serveur (propriétaire)")
          .addStringOption((o) => o.setName("nom").setDescription("Nom du réseau").setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) => s.setName("code").setDescription("Émettre un code d'adhésion (propriétaire du réseau)"))
      .addSubcommand((s) =>
        s
          .setName("rejoindre")
          .setDescription("Faire entrer ce serveur dans un réseau (propriétaire)")
          .addStringOption((o) => o.setName("code").setDescription("Code d'adhésion").setRequired(true).setMaxLength(20)),
      )
      .addSubcommand((s) => s.setName("quitter").setDescription("Sortir ce serveur du réseau"))
      .addSubcommand((s) =>
        s
          .setName("partage")
          .setDescription("Partager les bannissements avec le réseau")
          .addBooleanOption((o) => o.setName("actif").setDescription("Partager").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("journal")
          .setDescription("Salon recevant les incidents des autres serveurs")
          .addChannelOption((o) =>
            o.setName("salon").setDescription("Salon — vide = aucun").addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((s) => s.setName("voir").setDescription("Serveurs du réseau")),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("webhook")
      .setDescription("Webhook sortant signé (chaque incident envoyé à ton serveur)")
      .addSubcommand((s) =>
        s
          .setName("definir")
          .setDescription("Définir l'URL (un nouveau secret est généré)")
          .addStringOption((o) => o.setName("url").setDescription("https://…").setRequired(true).setMaxLength(500)),
      )
      .addSubcommand((s) => s.setName("retirer").setDescription("Ne plus envoyer d'incidents"))
      .addSubcommand((s) => s.setName("tester").setDescription("Envoyer un évènement de test")),
  );

// ─── Exécution ───────────────────────────────────────────────────────────────

async function runStatus(interaction: Interaction) {
  const guild = interaction.guild;
  const cfg = await getGuildConfig(guild.id);
  const me = await guild.members.fetchMe();
  const missing = REQUIRED_PERMISSIONS.filter(([perm]) => !me.permissions.has(perm)).map(([, label]) => label);
  const above = guild.roles.cache.filter((role) => role.position > me.roles.highest.position).size;
  const modules = SECURITY_MODULES.map(
    (id) =>
      `${cfg.disabledModules.includes(id) ? "⏸️" : "✅"} ${SECURITY_MODULE_LABELS[id]}${PROTECTED_MODULES.has(id) ? " 🔒" : ""}`,
  );
  await show(interaction, "🛡️ Sécurité", [
    `**Rôle de sécurité** ${cfg.securityRoleId ? `<@&${cfg.securityRoleId}>` : "*aucun — propriétaire seul*"}`,
    `**Alertes** ${cfg.securityAlertChannelId ? `<#${cfg.securityAlertChannelId}>` : "*logs « sécurité »*"}`,
    `**Permissions** ${missing.length ? `⚠️ manquantes : ${missing.join(", ")}` : "✅ complètes"}`,
    `**Position de mon rôle** ${above ? `⚠️ ${above} rôle(s) au-dessus : je ne peux rien contre leurs porteurs` : "✅ au sommet"}`,
    `**Vérification** ${cfg.verifyState === "off" ? "*désactivée*" : cfg.verifyState === "preparing" ? "⏳ préparation (rôle donné aux membres présents)" : `✅ ${cfg.verifyMode}`}`,
    `**Sauvegardes** ${cfg.backupIntervalHours ? `toutes les ${cfg.backupIntervalHours} h, ${cfg.backupMessagesPerChannel} messages/salon` : "*automatiques désactivées*"}`,
    `**Anti-nuke** ${cfg.nukeDeleteThreshold} suppressions · ${cfg.nukeBanThreshold} bannissements · ${cfg.nukeCreateThreshold} créations / ${cfg.nukeWindowSec} s${cfg.nukeRestore ? ", restauration auto" : ""}`,
    `**Anti-spam** ${cfg.spamMaxMessages} msg / ${cfg.spamWindowSec} s · ${cfg.spamMaxMentions} mentions · ${cfg.spamDuplicateAccounts} comptes identiques`,
    `**NSFW images** ${imageAnalysisConfigured ? (cfg.nsfwImages ? `✅ seuil ${cfg.nsfwThreshold}` : "⏸️") : "*modèle absent*"}`,
    `**Webhook sortant** ${cfg.outboundWebhookUrl ? "✅ configuré" : outboundAvailable ? "*aucun*" : "*indisponible (clé absente)*"}`,
    "",
    ...modules,
    "-# 🔒 : ne se coupe que par le propriétaire ou le rôle de sécurité",
  ]);
}

async function runThresholds(interaction: Interaction, sub: string) {
  const o = interaction.options;
  const guildId = interaction.guildId;
  const pick = <T>(value: T | null, key: string, into: Record<string, unknown>) => {
    if (value !== null) into[key] = value;
  };
  const values: Record<string, unknown> = {};
  switch (sub) {
    case "antinuke":
      pick(o.getInteger("suppressions"), "nukeDeleteThreshold", values);
      pick(o.getInteger("bannissements"), "nukeBanThreshold", values);
      pick(o.getInteger("creations"), "nukeCreateThreshold", values);
      pick(o.getInteger("fenetre"), "nukeWindowSec", values);
      pick(o.getBoolean("restaurer"), "nukeRestore", values);
      break;
    case "antispam":
      pick(o.getInteger("messages"), "spamMaxMessages", values);
      pick(o.getInteger("fenetre"), "spamWindowSec", values);
      pick(o.getInteger("mentions"), "spamMaxMentions", values);
      pick(o.getInteger("caracteres"), "spamMaxChars", values);
      pick(o.getInteger("lignes"), "spamMaxLines", values);
      pick(o.getInteger("comptes-identiques"), "spamDuplicateAccounts", values);
      pick(o.getInteger("exclusion"), "spamTimeoutMinutes", values);
      break;
    case "phishing":
      pick(o.getInteger("exclusion"), "phishingTimeoutMinutes", values);
      break;
    case "nsfw":
      pick(o.getInteger("seuil"), "nsfwThreshold", values);
      pick(o.getBoolean("images"), "nsfwImages", values);
      break;
    case "surveillance":
      pick(o.getInteger("age-compte"), "staffMinAccountAgeDays", values);
      pick(o.getInteger("anciennete"), "staffMinMemberDays", values);
      pick(o.getBoolean("quarantaine-usurpateur"), "impersonationQuarantine", values);
      break;
    case "sauvegardes":
      pick(o.getInteger("intervalle"), "backupIntervalHours", values);
      pick(o.getInteger("messages"), "backupMessagesPerChannel", values);
      pick(o.getInteger("conservation"), "backupRetention", values);
      break;
    case "verrouillage":
      pick(o.getInteger("jours"), "raidLockdownMinAgeDays", values);
      break;
  }
  if (!Object.keys(values).length) {
    await refuse(interaction, "Aucune valeur fournie.");
    return;
  }
  await updateGuildConfig(guildId, values);
  await ok(interaction, `Réglages **${sub}** enregistrés. Détail : \`/securite statut\`.`);
}

async function runExemption(interaction: Interaction, sub: string) {
  const cfg = await getGuildConfig(interaction.guildId);
  if (sub === "salon-ajouter" || sub === "salon-retirer") {
    const channel = interaction.options.getChannel("salon", true);
    const set = new Set(cfg.spamExemptChannelIds);
    if (sub === "salon-ajouter") set.add(channel.id);
    else set.delete(channel.id);
    await updateGuildConfig(interaction.guildId, { spamExemptChannelIds: [...set] });
    await ok(interaction, sub === "salon-ajouter" ? `<#${channel.id}> est exempté de l'anti-spam.` : `<#${channel.id}> est de nouveau surveillé.`);
    return;
  }
  const domain = hostOf(interaction.options.getString("domaine", true));
  if (!domain || !domain.includes(".")) {
    await refuse(interaction, "Domaine invalide.");
    return;
  }
  const set = new Set(cfg.phishingAllowDomains);
  if (sub === "domaine-ajouter") set.add(domain);
  else set.delete(domain);
  await updateGuildConfig(interaction.guildId, { phishingAllowDomains: [...set] });
  await ok(interaction, sub === "domaine-ajouter" ? `\`${domain}\` est autorisé.` : `\`${domain}\` n'est plus autorisé.`);
}

async function runNetwork(interaction: Interaction, sub: string) {
  const guild = interaction.guild;
  const membership = await getMembership(guild.id);
  const isOwner = interaction.user.id === guild.ownerId;

  switch (sub) {
    case "creer": {
      if (!isOwner) return refuse(interaction, "Seul le propriétaire du serveur crée un réseau.");
      if (membership) return refuse(interaction, `Ce serveur est déjà dans le réseau « ${membership.network.name} ».`);
      const network = await createNetwork(guild, interaction.options.getString("nom", true));
      return ok(interaction, `Réseau « ${network.name} » créé. Invite d'autres serveurs avec \`/securite reseau code\`.`);
    }
    case "code": {
      if (!membership) return refuse(interaction, "Ce serveur n'est dans aucun réseau.");
      if (membership.network.ownerId !== interaction.user.id)
        return refuse(interaction, "Seul le propriétaire du réseau émet des codes d'adhésion.");
      const code = await issueJoinCode(membership.network.id);
      return ok(
        interaction,
        `Code d'adhésion (usage unique, 24 h) : \`${code}\`\nÀ utiliser par le propriétaire de l'autre serveur : \`/securite reseau rejoindre\`.`,
      );
    }
    case "rejoindre": {
      if (!isOwner) return refuse(interaction, "Seul le propriétaire du serveur peut le faire entrer dans un réseau.");
      if (membership) return refuse(interaction, `Ce serveur est déjà dans le réseau « ${membership.network.name} ».`);
      const network = await joinNetwork(guild.id, interaction.options.getString("code", true).trim());
      if (!network) return refuse(interaction, "Code invalide ou expiré.");
      return ok(interaction, `Ce serveur a rejoint le réseau « ${network.name} ». Les bannissements y sont partagés.`);
    }
    case "quitter": {
      if (!membership) return refuse(interaction, "Ce serveur n'est dans aucun réseau.");
      await leaveNetwork(guild.id);
      return ok(interaction, `Ce serveur a quitté le réseau « ${membership.network.name} ».`);
    }
    case "partage": {
      if (!membership) return refuse(interaction, "Ce serveur n'est dans aucun réseau.");
      const actif = interaction.options.getBoolean("actif", true);
      await setShareBans(guild.id, actif);
      return ok(interaction, actif ? "Bannissements partagés avec le réseau." : "Bannissements gardés pour ce serveur.");
    }
    case "journal": {
      const channel = interaction.options.getChannel("salon");
      await updateGuildConfig(guild.id, { networkLogChannelId: channel?.id ?? null });
      return ok(interaction, channel ? `Les incidents du réseau arriveront dans <#${channel.id}>.` : "Journal réseau désactivé.");
    }
    case "voir": {
      if (!membership) return show(interaction, "🌐 Réseau", ["*Ce serveur n'est dans aucun réseau.*"]);
      const rows = await networkGuilds(membership.network.id);
      return show(interaction, `🌐 Réseau « ${membership.network.name} »`, [
        `**Propriétaire** <@${membership.network.ownerId}>`,
        "",
        ...rows.map((row) => {
          const name = interaction.client.guilds.cache.get(row.guildId)?.name ?? row.guildId;
          return `${row.shareBans ? "🔗" : "⛓️‍💥"} ${name}`;
        }),
      ]);
    }
  }
}

async function runWebhook(interaction: Interaction, sub: string) {
  if (!outboundAvailable)
    return refuse(interaction, "Webhook sortant indisponible : `SECURITY_WEBHOOK_KEY` manque dans la configuration du bot.");
  switch (sub) {
    case "definir": {
      const secret = await configureWebhook(interaction.guildId, interaction.options.getString("url", true)).catch(
        (err: unknown) => err as Error,
      );
      if (secret instanceof Error) return refuse(interaction, secret.message);
      return ok(
        interaction,
        [
          "Webhook enregistré. Secret de signature, **affiché une seule fois** :",
          `\`${secret}\``,
          "Chaque envoi porte `X-Clover-Signature: t=<horodatage>,v1=<hmac>` — HMAC-SHA256 de `<horodatage>.<corps>` avec ce secret. Refuse un horodatage de plus de 5 minutes.",
        ].join("\n"),
      );
    }
    case "retirer":
      await removeWebhook(interaction.guildId);
      return ok(interaction, "Webhook sortant retiré.");
    case "tester": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const error = await testWebhook(interaction.guildId);
      return error ? refuse(interaction, `Échec : ${error}`) : ok(interaction, "Évènement de test livré.");
    }
  }
}

const securite: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand(true);
    const key = group ? `${group}/${sub}` : sub;

    if (!READ_ONLY.has(key) && !(await hasSecurityAuthority(guild, interaction.user.id))) {
      await refuse(interaction, AUTHORITY_REFUSAL);
      return;
    }

    switch (group) {
      case "seuils":
        return runThresholds(interaction, sub);
      case "exemption":
        return runExemption(interaction, sub);
      case "reseau":
        return runNetwork(interaction, sub);
      case "webhook":
        return runWebhook(interaction, sub);
    }

    switch (key) {
      case "statut":
        return runStatus(interaction);

      case "role": {
        // Le rôle ouvre le droit de couper les protections : le propriétaire
        // seul le choisit, comme il est seul à pouvoir le donner.
        if (interaction.user.id !== guild.ownerId)
          return refuse(interaction, "Seul le propriétaire du serveur choisit le rôle de sécurité.");
        const role = interaction.options.getRole("role");
        if (role) {
          const me = await guild.members.fetchMe();
          if (role.managed || role.id === guild.id)
            return refuse(interaction, "Choisis un rôle ordinaire (ni @everyone, ni rôle d'intégration).");
          // Au-dessus du bot, le rôle ne pourrait pas être retiré à qui se l'attribue.
          if (role.position >= me.roles.highest.position)
            return refuse(interaction, "Ce rôle est au-dessus du mien : je ne pourrais pas le retirer en cas d'abus.");
        }
        await updateGuildConfig(guild.id, { securityRoleId: role?.id ?? null });
        return ok(
          interaction,
          role
            ? `Rôle de sécurité : ${role}. Ses porteurs peuvent couper les protections ; s'il est donné par un autre que toi, il est retiré.`
            : "Plus de rôle de sécurité : toi seul peux couper les protections.",
        );
      }

      case "alertes": {
        const salon = interaction.options.getChannel("salon");
        await updateGuildConfig(guild.id, { securityAlertChannelId: salon?.id ?? null });
        return ok(
          interaction,
          salon ? `Les incidents de sécurité iront dans <#${salon.id}>.` : "Les incidents de sécurité iront dans les logs « sécurité ».",
        );
      }

      case "incidents": {
        const incidents = await recentIncidents(guild.id, 15);
        return show(
          interaction,
          "🛡️ Derniers incidents",
          incidents.length
            ? incidents.map((i) => {
                const at = Math.floor(i.createdAt.getTime() / 1_000);
                const actor = i.actorId ? `<@${i.actorId}>` : "auteur inconnu";
                return `\`#${i.id}\` <t:${at}:R> **${incidentLabel(i.type)}** — ${actor}${i.resolvedAt ? " · annulé" : ""}`;
              })
            : ["*Aucun incident.*"],
        );
      }

      case "annuler": {
        const incident = await getIncident(guild.id, interaction.options.getInteger("incident", true));
        if (!incident) return refuse(interaction, "Incident introuvable.");
        if (incident.resolvedAt) return refuse(interaction, "Cet incident a déjà été annulé.");
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const done = await undoIncident(guild, incident, interaction.user.id);
        return ok(interaction, done.length ? done.join("\n") : "Rien à annuler pour cet incident.");
      }

      case "module": {
        const id = interaction.options.getString("nom", true) as DashboardModule;
        const actif = interaction.options.getBoolean("actif", true);
        const cfg = await getGuildConfig(guild.id);
        const disabled = cfg.disabledModules.filter((m) => m !== id);
        if (!actif) disabled.push(id);
        await updateGuildConfig(guild.id, { disabledModules: disabled });
        return ok(interaction, `${SECURITY_MODULE_LABELS[id]} ${actif ? "activé" : "coupé"}.`);
      }

      case "confiance/ajouter": {
        const user = interaction.options.getUser("compte", true);
        await addTrusted(guild.id, user.id, interaction.user.id);
        return ok(interaction, `${user} est de confiance : les protections ne le sanctionneront pas.`);
      }
      case "confiance/retirer": {
        const user = interaction.options.getUser("compte", true);
        const removed = await removeTrusted(guild.id, user.id);
        return removed ? ok(interaction, `${user} n'est plus de confiance.`) : refuse(interaction, `${user} n'est pas dans la liste.`);
      }
      case "confiance/liste": {
        const ids = await listTrusted(guild.id);
        return show(interaction, "🛡️ Comptes de confiance", [
          `**D'office** <@${guild.ownerId}> (propriétaire) et les porteurs du rôle de sécurité`,
          "",
          ids.length ? ids.map((id) => `<@${id}>`).join("\n") : "*Aucun autre compte.*",
        ]);
      }

      case "bot/attente": {
        const bots = await pendingBots(guild.id);
        return show(
          interaction,
          "🤖 Bots en quarantaine",
          bots.length ? bots.map((b) => `<@${b.botId}>${b.addedBy ? ` — ajouté par <@${b.addedBy}>` : ""}`) : ["*Aucun bot en attente.*"],
        );
      }
      case "bot/autoriser": {
        const bot = interaction.options.getUser("bot", true);
        const error = await approveBot(guild, bot.id, interaction.user.id);
        return error ? refuse(interaction, error) : ok(interaction, `${bot} est autorisé : ses permissions lui sont rendues.`);
      }
      case "bot/expulser": {
        const bot = interaction.options.getUser("bot", true);
        const error = await kickQuarantinedBot(guild, bot.id, interaction.user.id);
        return error ? refuse(interaction, error) : ok(interaction, `${bot} a été expulsé.`);
      }

      case "verification/activer": {
        const role = interaction.options.getRole("role", true);
        const channel = interaction.options.getChannel("salon", true, [ChannelType.GuildText]);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const error = await activateVerification(
          guild,
          role,
          channel,
          interaction.options.getString("mode") === "captcha" ? "captcha" : "bouton",
          interaction.options.getInteger("delai") ?? 0,
          interaction.user.id,
        );
        if (error) return refuse(interaction, error);
        return ok(
          interaction,
          `Vérification en préparation : ${role} est d'abord donné à tous les membres présents, puis @everyone perd la vue des salons. Suivi : \`/securite statut\`.\nUne sauvegarde a été faite avant (\`/sauvegarde liste\`).`,
        );
      }
      case "verification/desactiver":
        await deactivateVerification(guild);
        return ok(interaction, "Vérification désactivée : @everyone voit de nouveau les salons.");
    }
  },
};

export default securite;
