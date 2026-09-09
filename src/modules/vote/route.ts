import type { CloverClient } from "../../client";
import { env } from "../../config";
import type { IngressReply, IngressRoute } from "../../lib/ingress";
import { logger } from "../../lib/logger";
import { deliverVoteRewards, recordVote } from "./manager";

/**
 * Réception des votes (`POST`/`GET /vote`, cf. `lib/ingress.ts`). Les listes de
 * serveurs Minecraft n'ont pas de format commun : on accepte le pseudo sous
 * plusieurs noms de champ, en JSON, en formulaire ou en query string.
 */

/** Le pseudo peut arriver sous une demi-douzaine de noms selon la liste. */
function pickUsername(source: Record<string, unknown>): string | null {
  for (const key of ["username", "player", "pseudo", "playername", "name", "user"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function createVoteRoute(client: CloverClient): IngressRoute {
  return {
    path: "/vote",
    token: env.VOTE_TOKEN,
    async handle({ payload }): Promise<IngressReply> {
      const username = pickUsername(payload);
      if (!username) return { status: 400, message: "Pseudo Minecraft manquant" };

      const site =
        typeof payload.site === "string" && payload.site.trim()
          ? payload.site.trim()
          : "liste inconnue";

      const { vote, duplicate } = await recordVote(client, { site, username });
      if (duplicate) return { status: 200, message: "Vote déjà enregistré" };

      // Répondre dès que le vote est durable : les récompenses (RCON sur six
      // serveurs, rôle, annonce) se comptent en secondes, et une liste qui
      // n'obtient pas sa réponse à temps repostera le même vote.
      void deliverVoteRewards(client, vote).catch((err: unknown) =>
        logger.error({ err, username, site }, "Récompenses de vote impossibles"),
      );
      return { status: 200, message: "Vote enregistré" };
    },
  };
}
