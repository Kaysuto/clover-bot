import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { env } from "../config";
import { logger } from "./logger";

/**
 * Serveur HTTP d'entrée du bot : le seul endroit par lequel le monde extérieur
 * peut le faire agir. Deux appelants aujourd'hui — les listes de serveurs qui
 * signalent un vote (`/vote`) et le plugin clover-core qui signale un événement
 * de jeu (`/game`) — chacun avec **son propre jeton**.
 *
 * Un jeton par route, jamais un jeton partagé : celui des votes est distribué à
 * des tiers (chaque liste le détient), alors que `/game` déclenche des actions
 * de modération. Une liste dont le jeton fuite ne doit pas pouvoir bannir sur
 * Discord.
 *
 * Fermé par défaut : le port ne s'ouvre que si `VOTE_HTTP_PORT` est défini et
 * qu'au moins une route a son jeton. Les jetons sont comparés en temps constant
 * et sont la seule protection de ce port public — toute nouvelle route qui
 * écrit passe par ce contrôle.
 */

export interface IngressRequest {
  /** Query string et corps fusionnés (le corps prime). */
  payload: Record<string, unknown>;
  ip: string;
}

export interface IngressReply {
  status: number;
  message: string;
}

export interface IngressRoute {
  /** Chemin exact, barre oblique comprise : `/vote`. */
  path: string;
  /** Jeton attendu ; la route reste fermée tant qu'il est absent du `.env`. */
  token: string | undefined;
  handle(request: IngressRequest): Promise<IngressReply>;
}

/** Un vote ou un événement de jeu tient en quelques centaines d'octets. */
const MAX_BODY_BYTES = 8_192;

/** Anti-abus minimal : 30 requêtes par minute et par IP. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

const routes = new Map<string, IngressRoute>();
let server: Server | null = null;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    // Une entrée par IP, sur un port public : sans purge des fenêtres closes,
    // la table ne fait que croître sur un process qui tourne des mois.
    if (hits.size > 1_000) {
      for (const [key, seen] of hits) {
        if (seen.resetAt < now) hits.delete(key);
      }
    }
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function tokenMatches(candidate: string | null, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

/**
 * Déclare une route. Sans jeton, la route est ignorée : c'est ainsi qu'une
 * intégration non configurée reste fermée plutôt qu'ouverte sans contrôle.
 */
export function registerIngressRoute(route: IngressRoute): void {
  if (!route.token) {
    logger.debug({ path: route.path }, "Route d'entrée ignorée (jeton absent)");
    return;
  }
  routes.set(route.path, route);
}

export function startIngress(): void {
  if (server || !env.VOTE_HTTP_PORT || routes.size === 0) return;

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
    const route = routes.get(url.pathname);
    if (!route?.token) {
      reply(404, "Chemin inconnu");
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      void (async () => {
        const payload = {
          ...Object.fromEntries(url.searchParams),
          ...parseBody(
            Buffer.concat(chunks).toString("utf8"),
            req.headers["content-type"] ?? "",
          ),
        };

        const token =
          (req.headers["x-clover-token"] as string | undefined) ??
          // Nom historique, conservé pour les listes de vote déjà configurées.
          (req.headers["x-vote-token"] as string | undefined) ??
          (typeof payload.token === "string" ? payload.token : null) ??
          null;
        if (!tokenMatches(token, route.token!)) {
          logger.warn({ ip, path: route.path }, "Appel refusé : jeton invalide");
          reply(401, "Jeton invalide");
          return;
        }

        try {
          const result = await route.handle({ payload, ip });
          reply(result.status, result.message);
        } catch (err) {
          logger.error({ err, path: route.path }, "Route d'entrée en erreur");
          reply(500, "Erreur interne");
        }
      })();
    });
  });

  server.on("error", (err) =>
    logger.error({ err }, "Serveur d'entrée en erreur (port déjà utilisé ?)"),
  );

  server.listen(env.VOTE_HTTP_PORT, () =>
    logger.info(
      { port: env.VOTE_HTTP_PORT, paths: [...routes.keys()] },
      "Serveur d'entrée à l'écoute",
    ),
  );
}

export async function stopIngress(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
}
