import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/**
 * Primitives du webhook sortant, sans état : signature des livraisons,
 * chiffrement du secret au repos et refus des adresses internes (SSRF).
 */

/** En-tête `X-Clover-Signature` : horodatage + HMAC-SHA256 de `t.corps`. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** Clé de 32 octets, fournie en hexadécimal (64 caractères) ou en base64. */
export function parseKey(raw: string): Buffer | null {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** AES-256-GCM : `iv.tag.chiffré`, chaque partie en base64url. */
export function encryptSecret(key: Buffer, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(key: Buffer, stored: string): string | null {
  const [iv, tag, data] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Adresse à ne jamais joindre depuis le bot : boucle locale, réseaux privés,
 * lien local (dont les métadonnées cloud 169.254.169.254), CGNAT, multicast.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4 encapsulée : `::ffff:127.0.0.1`, ou sa forme hexadécimale
    // `::ffff:7f00:1` que produit `new URL` — jugée comme l'IPv4 qu'elle porte.
    if (lower.startsWith("::ffff:")) {
      const rest = lower.slice(7);
      if (isIP(rest) === 4) return isPrivateAddress(rest);
      const [hi, lo] = rest.split(":").map((h) => parseInt(h, 16));
      if (hi === undefined || lo === undefined || Number.isNaN(hi) || Number.isNaN(lo)) return true;
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return (
      // NAT64 et 6to4 : des passerelles vers n'importe quelle IPv4, y compris interne.
      lower.startsWith("64:ff9b:") ||
      lower.startsWith("2002:") ||
      // ::/96 réservé (non spécifiée, boucle locale, IPv4 compatible).
      lower.startsWith("::") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  return true;
}

/** URL acceptable pour un webhook sortant (forme seulement ; l'IP est vérifiée à la connexion). */
export function validateWebhookUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "L'URL doit commencer par https://.";
    if (url.username || url.password) return "L'URL ne doit pas contenir d'identifiants.";
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, "")))
      return "Adresse interne refusée.";
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return "Adresse interne refusée.";
    return null;
  } catch {
    return "URL invalide.";
  }
}
