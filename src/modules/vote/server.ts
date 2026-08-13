import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { CloverClient } from "../../client";
import { env, voteEndpointConfigured } from "../../config";
import { logger } from "../../lib/logger";
import { recordVote } from "./manager";

/**
 * Endpoint de réception des votes (`POST`/`GET /vote`). Les listes de serveurs
 * Minecraft n'ont pas de format commun : on accepte le pseudo sous plusieurs
 * noms de champ, en JSON, en formulaire ou en query string.
 *
 * Fermé par défaut : il ne démarre que si `VOTE_HTTP_PORT` **et** `VOTE_TOKEN`
 * sont renseignés. Le jeton est comparé en temps constant et doit être long et
 * aléatoire — c'est la seule protection de cet endpoint public.
 */

let server: Server | null = null;

/** Anti-abus minimal : 30 requêtes par minute et par IP. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function tokenMatches(candidate: string | null): boolean {
  if (!candidate || !env.VOTE_TOKEN) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.VOTE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Le pseudo peut arriver sous une demi-douzaine de noms selon la liste. */
function pickUsername(source: Record<string, unknown>): string | null {
  for (const key of ["username", "player", "pseudo", "playername", "name", "user"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseBody(raw: string, contentType: string): Record<string, unknown> {
  if (!raw) return {};
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function startVoteServer(client: CloverClient): void {
  if (!voteEndpointConfigured || server) return;

  server = createServer((req, res) => {
    const reply = (status: number, message: string) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: status < 400, message }));
    };

    const ip = req.socket.remoteAddress ?? "inconnu";
    if (rateLimited(ip)) {
      reply(429, "Trop de requêtes");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/vote") {
      reply(404, "Chemin inconnu");
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Un vote tient en quelques centaines d'octets : au-delà, on coupe.
      if (size > 8_192) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      void (async () => {
        const body = parseBody(
          Buffer.concat(chunks).toString("utf8"),
          req.headers["content-type"] ?? "",
        );
        const query = Object.fromEntries(url.searchParams);
        const payload = { ...query, ...body };

        const token =
          (req.headers["x-vote-token"] as string | undefined) ??
          (typeof payload.token === "string" ? payload.token : null) ??
          null;
        if (!tokenMatches(token)) {
          logger.warn({ ip }, "Vote refusé : jeton invalide");
          reply(401, "Jeton invalide");
          return;
        }

        const username = pickUsername(payload);
        if (!username) {
          reply(400, "Pseudo Minecraft manquant");
          return;
        }

        const site =
          typeof payload.site === "string" && payload.site.trim()
            ? payload.site.trim()
            : "liste inconnue";

        try {
          await recordVote(client, { site, username });
          reply(200, "Vote enregistré");
        } catch (err) {
          logger.error({ err, username, site }, "Enregistrement du vote impossible");
          reply(500, "Erreur interne");
        }
      })();
    });
  });

  server.on("error", (err) =>
    logger.error({ err }, "Serveur de votes en erreur (port déjà utilisé ?)"),
  );

  server.listen(env.VOTE_HTTP_PORT, () =>
    logger.info(
      { port: env.VOTE_HTTP_PORT },
      "Endpoint de vote à l'écoute sur /vote",
    ),
  );
}

export async function stopVoteServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
}
