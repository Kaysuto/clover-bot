import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
} from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";

/**
 * Message de bienvenue par défaut. Il vit dans le code plutôt qu'en base : une
 * guilde qui n'a rien personnalisé profite ainsi de chaque amélioration de la
 * formulation, sans migration ni commande à rejouer.
 */
export const DEFAULT_WELCOME_MESSAGE = [
  "Content de te voir parmi nous, {user} ! Tu es le **{count}ᵉ** membre de la communauté.",
  "",
  "Pour bien commencer :",
  "• Lis les règles du serveur avant de te lancer.",
  "• Lie ton compte Minecraft avec la commande `/lier` pour retrouver tes grades et tes récompenses en jeu.",
  "• Une question, un bug, un souci de boutique ? Ouvre un ticket, l'équipe te répond.",
  "",
  "Bon jeu sur {server} ! 🍀",
].join("\n");

/** Variables utilisables dans le modèle, affichées dans `/config accueil`. */
export const WELCOME_PLACEHOLDERS = "{user}, {server}, {count}";

export function renderWelcome(
  template: string,
  guild: Guild,
  userId: string,
): string {
  return template
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{server}", guild.name)
    .replaceAll("{count}", String(guild.memberCount));
}

export function welcomeEmbed(
  guild: Guild,
  userId: string,
  template: string,
): EmbedBuilder {
  return brandEmbed()
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle(`🍀 Bienvenue sur ${guild.name} !`.slice(0, 256))
    .setDescription(renderWelcome(template, guild, userId))
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setFooter({
      text: "Message automatique • Réponds-nous en ouvrant un ticket sur le serveur",
    });
}

/** Bouton de retour vers le serveur (utile depuis un MP, où il n'y a aucun lien). */
function serverButton(guild: Guild) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Aller sur le serveur")
      .setEmoji("🍀")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guild.id}`),
  );
}

/**
 * MP de bienvenue à l'arrivée d'un membre. Silencieux si le membre a fermé ses
 * messages privés — un MP raté ne doit jamais faire échouer l'arrivée.
 */
export async function sendWelcomeDm(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.welcomeDmEnabled) return;

  await member
    .send({
      embeds: [
        welcomeEmbed(
          member.guild,
          member.id,
          cfg.welcomeDmMessage ?? DEFAULT_WELCOME_MESSAGE,
        ),
      ],
      components: [serverButton(member.guild)],
    })
    .catch((err) =>
      logger.debug(
        { err, userId: member.id },
        "MP de bienvenue impossible (MP fermés ?)",
      ),
    );
}
