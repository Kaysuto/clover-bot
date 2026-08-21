import { env, siteApiConfigured } from "../config";
import { logger } from "./logger";

/**
 * Client des endpoints `/api/internal/bot/*` du site.
 *
 * Toute la monnaie vit côté site : le bot ne lit ni n'écrit jamais l'économie
 * in-game directement. Il demande un solde, un catalogue, un achat ou un
 * versement — le site tient le verrou, le débit RCON et la trace dans
 * `shop_orders`. Un seul endroit sait déplacer de l'argent.
 */

export type SiteResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SiteProduct {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priceCents: number;
  credits: number;
}

export interface SiteCatalogue {
  products: SiteProduct[];
  perEuro: number;
}

export interface SiteBalance {
  minecraftUsername: string;
  balance: number;
}

export interface SitePurchase {
  success: true;
  productName: string;
  credits: number;
  remaining: number;
}

export interface SiteDeposit {
  success: true;
  alreadyApplied: boolean;
  minecraftUsername: string;
}

const TIMEOUT_MS = 15_000;

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<SiteResult<T>> {
  if (!siteApiConfigured) {
    return { ok: false, error: "L'intégration avec le site n'est pas configurée." };
  }

  const url = `${env.SITE_API_URL!.replace(/\/$/, "")}/api/internal/bot${path}`;
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${env.SITE_API_TOKEN}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `Le site a répondu ${response.status}.`;
      // 401/503 sont des erreurs de configuration : elles méritent un log,
      // contrairement à un 409 « solde insuffisant » qui est une réponse normale.
      if (response.status !== 409) {
        logger.warn({ path, status: response.status, error }, "Appel au site refusé");
      }
      return { ok: false, error };
    }

    return { ok: true, data: payload as T };
  } catch (err) {
    logger.warn({ err, path }, "Site injoignable");
    return { ok: false, error: "Le site est injoignable pour le moment." };
  }
}

export function fetchCatalogue(): Promise<SiteResult<SiteCatalogue>> {
  return call<SiteCatalogue>("/shop/products");
}

export function fetchBalance(discordId: string): Promise<SiteResult<SiteBalance>> {
  return call<SiteBalance>(
    `/credits/balance?discordId=${encodeURIComponent(discordId)}`,
  );
}

export function purchase(
  discordId: string,
  productId: string,
): Promise<SiteResult<SitePurchase>> {
  return call<SitePurchase>("/shop/purchase", {
    method: "POST",
    body: { discordId, productId },
  });
}

/**
 * Verse des pièces. `key` doit être stable et unique pour la récompense
 * concernée : un réessai avec la même clé ne verse pas deux fois.
 */
export function deposit(input: {
  key: string;
  discordId: string;
  amount: number;
  reason: string;
}): Promise<SiteResult<SiteDeposit>> {
  return call<SiteDeposit>("/credits/deposit", { method: "POST", body: input });
}
