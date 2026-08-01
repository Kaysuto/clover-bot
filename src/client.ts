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
      // MessageContent volontairement absent : l'XP n'a besoin que de
      // l'auteur et du salon, messageCreate s'émet sans cet intent.
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        // Bannissements/débannissements pour les logs (intent non privilégié).
        GatewayIntentBits.GuildModeration,
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
