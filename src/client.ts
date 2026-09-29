import { ActivityType, Client, Collection, GatewayIntentBits } from "discord.js";
import { env } from "./config";
import type { Command, ComponentHandler, DmComponentHandler } from "./types";

export class CloverClient extends Client {
  /** Commandes slash, indexées par nom. */
  readonly commands = new Collection<string, Command>();
  /** Handlers de composants/modals, indexés par préfixe de customId. */
  readonly components = new Collection<string, ComponentHandler>();
  /** Idem, pour les composants publiés en message privé (hors guilde). */
  readonly dmComponents = new Collection<string, DmComponentHandler>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        // Privilégié : contenu, pièces jointes et embeds des messages, sans
        // lesquels anti-phishing, filtre NSFW, anti-spam de contenu et
        // sauvegarde des messages sont aveugles.
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        // Création de webhooks (anti-webhook) et émojis/stickers (logs).
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildExpressions,
        // Bannissements/débannissements pour les logs (intent non privilégié).
        GatewayIntentBits.GuildModeration,
        // Déclenchements des règles AutoMod, pour les logs (intent non privilégié).
        // Le filtrage lui-même est fait par Discord, sans MessageContent.
        GatewayIntentBits.AutoModerationExecution,
      ],
      partials: [],
      // Déclaré ici (et non après la connexion) : discord.js le renvoie dans
      // chaque IDENTIFY, donc le statut survit aux reconnexions gateway.
      presence: {
        status: "online",
        activities: [
          {
            name: env.BOT_ACTIVITY_NAME,
            type: ActivityType[env.BOT_ACTIVITY_TYPE],
          },
        ],
      },
    });
  }
}
