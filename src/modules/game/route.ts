import type { CloverClient } from "../../client";
import { env } from "../../config";
import type { IngressRoute } from "../../lib/ingress";
import { handleGameEvent } from "./events";

/**
 * Route `/game` : le plugin clover-core y pousse ses événements (sanctions
 * posées en jeu, démarrage/arrêt des serveurs). Jeton propre — `GAME_TOKEN` —
 * distinct de celui des votes, qui est distribué à des tiers.
 */
export function createGameRoute(client: CloverClient): IngressRoute {
  return {
    path: "/game",
    token: env.GAME_TOKEN,
    handle: ({ payload }) => handleGameEvent(client, payload),
  };
}
