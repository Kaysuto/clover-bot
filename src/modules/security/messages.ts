import type { Message } from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { checkSpam } from "./antispam";
import { checkWebhookMessage } from "./antiwebhook";
import { checkNsfw } from "./nsfw";
import { checkPhishing } from "./phishing";
import { ownWebhooks } from "./snapshot";

/**
 * Contrôle d'un message avant tout autre traitement (XP, statistiques). Du
 * plus grave au plus bénin : un lien d'hameçonnage est traité comme tel même
 * s'il arrive dans une rafale. Retourne vrai si le message a été supprimé.
 */
export async function inspectMessage(message: Message): Promise<boolean> {
  if (!message.inGuild()) return false;
  if (message.author.id === message.client.user.id) return false;
  if (message.webhookId && ownWebhooks.has(message.webhookId)) return false;

  const cfg = await getGuildConfig(message.guildId);
  if (await checkPhishing(message, cfg)) return true;
  if (await checkNsfw(message, cfg)) return true;
  if (message.webhookId) return checkWebhookMessage(message, cfg);
  if (message.author.bot) return false;
  return checkSpam(message, cfg);
}

/**
 * Message modifié : seuls les contenus dangereux sont recherchés — un lien
 * piégé ajouté après coup, pour échapper au contrôle de l'envoi.
 */
export async function inspectEditedMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  const cfg = await getGuildConfig(message.guildId);
  if (await checkPhishing(message, cfg)) return;
  await checkNsfw(message, cfg);
}
