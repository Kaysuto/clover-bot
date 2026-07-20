import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Command, ComponentHandler } from "./types";

export class CloverClient extends Client {
  /** Commandes slash, indexées par nom. */
  readonly commands = new Collection<string, Command>();
  /** Handlers de composants/modals, indexés par préfixe de customId. */
  readonly components = new Collection<string, ComponentHandler>();

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
      ],
      partials: [],
    });
  }
}
