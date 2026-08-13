import type {
  AutocompleteInteraction,
  Awaitable,
  ChatInputCommandInteraction,
  ClientEvents,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { CloverClient } from "./client";

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  execute(
    interaction: ChatInputCommandInteraction<"cached">,
    client: CloverClient,
  ): Promise<void>;
  /**
   * Complétion des options `setAutocomplete(true)`. Les listes dynamiques
   * (serveurs du réseau, grades…) ne peuvent pas passer par `addChoices`,
   * qui est figé au déploiement de la commande.
   */
  autocomplete?(
    interaction: AutocompleteInteraction<"cached">,
    client: CloverClient,
  ): Promise<void>;
}

export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(client: CloverClient, ...args: ClientEvents[K]): Awaitable<void>;
}

/** Interaction de composant (bouton/select) ou de modal, en guilde. */
export type ComponentInteraction =
  | MessageComponentInteraction<"cached">
  | ModalSubmitInteraction<"cached">;

/**
 * Handler enregistré par préfixe de customId.
 * customId = "prefix:action:arg1:arg2..." (voir lib/ids.ts)
 */
export type ComponentHandler = (
  interaction: ComponentInteraction,
  action: string,
  args: string[],
  client: CloverClient,
) => Promise<void>;

/** Interaction de composant reçue en message privé : aucune guilde, donc ni
 * `member` ni `guild` — le contexte doit venir du customId ou de la base. */
export type DmComponentInteraction =
  | MessageComponentInteraction
  | ModalSubmitInteraction;

/** Handler des composants publiés en MP (voir `dmComponentHandlers`). */
export type DmComponentHandler = (
  interaction: DmComponentInteraction,
  action: string,
  args: string[],
  client: CloverClient,
) => Promise<void>;
