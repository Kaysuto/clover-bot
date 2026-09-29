import { lookup } from "node:dns";
import { request } from "node:https";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { env } from "../../config";
import { db } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botWebhookDeliveries } from "../../db/schema";
import { logger } from "../../lib/logger";
import {
  decryptSecret,
  encryptSecret,
  generateSecret,
  isPrivateAddress,
  parseKey,
  signPayload,
  validateWebhookUrl,
} from "./signature";

/**
 * Webhook sortant : chaque incident est POSTé, signé, à l'URL choisie par la
 * guilde. Les livraisons vivent en base et sont rejouées par le job
 * `security-webhooks` avec un délai croissant — un redémarrage ou une panne du
 * destinataire ne perd rien.
 */

const MAX_ATTEMPTS = 5;
/** Délai avant chaque nouvel essai, en minutes. */
const BACKOFF_MIN = [1, 5, 30, 120, 720];
const TIMEOUT_MS = 5_000;

const key = env.SECURITY_WEBHOOK_KEY ? parseKey(env.SECURITY_WEBHOOK_KEY) : null;

export const outboundAvailable = key !== null;

export async function enqueueDelivery(guildId: string, event: string, payload: unknown): Promise<void> {
  if (!key) return;
  const cfg = await getGuildConfig(guildId);
  if (!cfg.outboundWebhookUrl || !cfg.outboundWebhookSecret) return;
  await db.insert(botWebhookDeliveries).values({ guildId, event, payload });
}

/**
 * Enregistre l'URL et génère un nouveau secret, retourné en clair une seule
 * fois : seul son chiffré est gardé.
 */
export async function configureWebhook(guildId: string, url: string): Promise<string> {
  if (!key) throw new Error("SECURITY_WEBHOOK_KEY absente");
  const refusal = validateWebhookUrl(url);
  if (refusal) throw new Error(refusal);
  const secret = generateSecret();
  await updateGuildConfig(guildId, {
    outboundWebhookUrl: url,
    outboundWebhookSecret: encryptSecret(key, secret),
  });
  return secret;
}

export async function removeWebhook(guildId: string): Promise<void> {
  await updateGuildConfig(guildId, { outboundWebhookUrl: null, outboundWebhookSecret: null });
  await db
    .delete(botWebhookDeliveries)
    .where(and(eq(botWebhookDeliveries.guildId, guildId), isNull(botWebhookDeliveries.deliveredAt)));
}

/**
 * Résolution DNS vérifiée à la connexion même : une vérification faite avant
 * `request` laisserait le nom se résoudre autrement entre les deux (rebinding).
 */
const guardedLookup: typeof lookup = ((hostname: string, options: object, callback: Function) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as Array<{ address: string; family: number }>;
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(new Error("Adresse interne refusée"));
    const wantsAll = (options as { all?: boolean }).all;
    if (wantsAll) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}) as typeof lookup;

/** Un POST signé ; résout sur le code HTTP, rejette sur erreur réseau. */
function post(url: string, secret: string, event: string, deliveryId: number, body: string) {
  const timestamp = Math.floor(Date.now() / 1_000);
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "user-agent": "CloverBot-Webhook/1",
          "x-clover-event": event,
          "x-clover-delivery": String(deliveryId),
          "x-clover-signature": signPayload(secret, timestamp, body),
        },
      },
      (res) => {
        res.resume(); // corps ignoré ; pas de suivi de redirection
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Délai dépassé")));
    req.on("error", reject);
    req.end(body);
  });
}

async function attempt(delivery: typeof botWebhookDeliveries.$inferSelect): Promise<string | null> {
  const cfg = await getGuildConfig(delivery.guildId);
  if (!key || !cfg.outboundWebhookUrl || !cfg.outboundWebhookSecret) return "Webhook retiré";
  const secret = decryptSecret(key, cfg.outboundWebhookSecret);
  if (!secret) return "Secret illisible (clé changée ?)";
  const refusal = validateWebhookUrl(cfg.outboundWebhookUrl);
  if (refusal) return refusal;
  try {
    const status = await post(
      cfg.outboundWebhookUrl,
      secret,
      delivery.event,
      delivery.id,
      JSON.stringify({ event: delivery.event, data: delivery.payload }),
    );
    return status >= 200 && status < 300 ? null : `HTTP ${status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Job (30 s) : livre les envois échus, dans l'ordre, et planifie les échecs. */
export async function tickDeliveries(): Promise<void> {
  if (!key) return;
  const due = await db
    .select()
    .from(botWebhookDeliveries)
    .where(and(isNull(botWebhookDeliveries.deliveredAt), lte(botWebhookDeliveries.nextAttemptAt, new Date())))
    .orderBy(asc(botWebhookDeliveries.id))
    .limit(20);

  for (const delivery of due) {
    const error = await attempt(delivery);
    const attempts = delivery.attempts + 1;
    if (!error) {
      await db
        .update(botWebhookDeliveries)
        .set({ attempts, deliveredAt: new Date(), lastError: null })
        .where(eq(botWebhookDeliveries.id, delivery.id));
      continue;
    }
    if (attempts >= MAX_ATTEMPTS) {
      logger.warn({ guildId: delivery.guildId, id: delivery.id, error }, "Webhook sortant abandonné");
      await db.delete(botWebhookDeliveries).where(eq(botWebhookDeliveries.id, delivery.id));
      continue;
    }
    const delayMin = BACKOFF_MIN[attempts - 1] ?? 720;
    await db
      .update(botWebhookDeliveries)
      .set({ attempts, lastError: error, nextAttemptAt: new Date(Date.now() + delayMin * 60_000) })
      .where(eq(botWebhookDeliveries.id, delivery.id));
  }
}

/** Envoi immédiat d'un évènement `test`, hors file ; retourne l'erreur ou null. */
export async function testWebhook(guildId: string): Promise<string | null> {
  const [row] = await db
    .insert(botWebhookDeliveries)
    .values({
      guildId,
      event: "test",
      payload: { message: "Test du webhook Clover", at: new Date().toISOString() },
      deliveredAt: new Date(),
    })
    .returning();
  if (!row) return "Envoi non préparé";
  const error = await attempt(row);
  await db.delete(botWebhookDeliveries).where(eq(botWebhookDeliveries.id, row.id));
  return error;
}
