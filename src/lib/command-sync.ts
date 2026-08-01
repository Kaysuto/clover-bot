import { Routes } from "discord.js";
import type { APIApplicationCommand, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type { CloverClient } from "../client";
import { commands } from "../commands";
import { env } from "../config";
import { logger } from "./logger";

/**
 * Publie les slash commands de la guilde quand elles diffèrent de ce que Discord a
 * enregistré. `npm run deploy` reste le déploiement explicite ; cette synchro au
 * démarrage évite qu'une commande ajoutée au code reste **invisible sur Discord**
 * faute d'avoir relancé le script (c'est ce qui est arrivé à `/lier` et `/delier`).
 *
 * Strictement limité aux commandes **de guilde** : l'application publie aussi des
 * commandes globales (intégration Minecraft), qu'un PUT sans `guildId` effacerait.
 */
export async function syncGuildCommands(client: CloverClient): Promise<void> {
  const desired = commands.map((c) => c.data.toJSON());
  const route = Routes.applicationGuildCommands(
    client.application?.id ?? env.DISCORD_CLIENT_ID,
    env.DISCORD_GUILD_ID,
  );

  const current = (await client.rest.get(route)) as APIApplicationCommand[];
  if (upToDate(current, desired)) {
    logger.debug({ count: desired.length }, "Slash commands déjà à jour");
    return;
  }

  await client.rest.put(route, { body: desired });
  const added = desired
    .map((c) => c.name)
    .filter((name) => !current.some((c) => c.name === name));
  logger.info(
    { count: desired.length, added },
    "Slash commands publiées sur la guilde",
  );
}

type Json = Record<string, unknown>;

function upToDate(
  current: APIApplicationCommand[],
  desired: RESTPostAPIApplicationCommandsJSONBody[],
): boolean {
  if (current.length !== desired.length) return false;
  const byName = new Map(current.map((c) => [c.name, c as unknown as Json]));
  return desired.every((command) => {
    const deployed = byName.get(command.name);
    return deployed ? same(deployed, command as unknown as Json) : false;
  });
}

function same(deployed: Json, desired: Json): boolean {
  if (signature(deployed) !== signature(desired)) return false;
  // `contexts` absent côté Discord = commande enregistrée avant l'existence du
  // champ : on ne peut rien en conclure, et republier à chaque démarrage pour
  // cette seule raison consommerait le quota de publication quotidien.
  const contexts = deployed.contexts as number[] | null | undefined;
  if (contexts == null) return true;
  return JSON.stringify(contexts) === JSON.stringify(desired.contexts ?? []);
}

/**
 * Empreinte des seuls champs que le code maîtrise. Tout le reste (id, version,
 * localisations, valeurs par défaut réécrites par Discord) est ignoré : les
 * comparer republierait à chaque démarrage. `SlashCommandBuilder#toJSON()` pose
 * toutes les clés, y compris à `undefined`, d'où les valeurs de repli.
 */
function signature(command: Json): string {
  return JSON.stringify({
    name: command.name,
    description: command.description ?? "",
    defaultMemberPermissions: command.default_member_permissions ?? null,
    options: normalizeOptions(command.options),
  });
}

/** Options et sous-commandes, dans l'ordre de déclaration (Discord le conserve). */
function normalizeOptions(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Json[]).map((option) => ({
    type: option.type,
    name: option.name,
    description: option.description,
    required: option.required ?? false,
    autocomplete: option.autocomplete ?? false,
    choices: Array.isArray(option.choices)
      ? (option.choices as Json[]).map((choice) => ({
          name: choice.name,
          value: choice.value,
        }))
      : [],
    channelTypes: option.channel_types ?? [],
    minValue: option.min_value ?? null,
    maxValue: option.max_value ?? null,
    minLength: option.min_length ?? null,
    maxLength: option.max_length ?? null,
    options: normalizeOptions(option.options),
  }));
}
