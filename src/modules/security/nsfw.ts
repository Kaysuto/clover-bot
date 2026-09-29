import type { Attachment, Message } from "discord.js";
import { env } from "../../config";
import type { GuildConfig } from "../../db/guild-config";
import { logger } from "../../lib/logger";
import { moduleEnabled } from "../dashboard/modules";
import { recordIncident } from "./incidents";
import { hostOf, extractUrls } from "./phishing-detect";
import { deleteQuietly } from "./sanctions";

/**
 * Filtre NSFW hors des salons marqués NSFW :
 *
 * - **texte** : les mots explicites relèvent du préréglage AutoMod de Discord
 *   (`/config automod grossieretes`) ; ici, les liens vers des sites adultes ;
 * - **images** : analyse locale par un modèle ONNX (`NSFW_MODEL_PATH`), sans
 *   rien envoyer à un service tiers. Sans modèle, cette partie est inactive.
 */

const ADULT_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "spankbang.com",
  "onlyfans.com",
  "fansly.com",
  "chaturbate.com",
  "stripchat.com",
  "brazzers.com",
  "rule34.xxx",
  "e-hentai.org",
  "nhentai.net",
  "hanime.tv",
];

const INPUT_SIZE = 224;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QUEUE = 50;
/** Ordre des sorties du modèle attendu (cf. `.env.example`). */
const CLASSES = ["drawings", "hentai", "neutral", "porn", "sexy"] as const;

type Session = import("onnxruntime-node").InferenceSession;
type OrtModule = typeof import("onnxruntime-node");

let model: Promise<{ ort: OrtModule; session: Session } | null> | null = null;

/** Chargement paresseux : le modèle ne coûte rien tant qu'aucune image n'arrive. */
function loadModel() {
  if (!model) {
    model = (async () => {
      if (!env.NSFW_MODEL_PATH) return null;
      try {
        const ort = await import("onnxruntime-node");
        const session = await ort.InferenceSession.create(env.NSFW_MODEL_PATH);
        logger.info({ path: env.NSFW_MODEL_PATH }, "Modèle NSFW chargé");
        return { ort, session };
      } catch (err) {
        logger.error({ err }, "Modèle NSFW illisible : analyse d'image désactivée");
        return null;
      }
    })();
  }
  return model;
}

export const imageAnalysisConfigured = Boolean(env.NSFW_MODEL_PATH);

/** Score explicite 0-1 d'une image (porn + hentai), null si l'analyse échoue. */
async function scoreImage(url: string): Promise<number | null> {
  const loaded = await loadModel();
  if (!loaded) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const input = Buffer.from(await res.arrayBuffer());

  const { default: sharp } = await import("sharp");
  const pixels = await sharp(input, { animated: false })
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill" })
    // Une image en niveaux de gris n'a qu'un canal : sans conversion, le
    // tenseur aurait la mauvaise taille et l'image échapperait au filtre.
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer();
  const data = Float32Array.from(pixels, (v) => v / 255);
  const tensor = new loaded.ort.Tensor("float32", data, [1, INPUT_SIZE, INPUT_SIZE, 3]);
  const inputName = loaded.session.inputNames[0]!;
  const output = await loaded.session.run({ [inputName]: tensor });
  const probs = output[loaded.session.outputNames[0]!]?.data as Float32Array | undefined;
  if (!probs || probs.length !== CLASSES.length) return null;
  return (probs[CLASSES.indexOf("porn")] ?? 0) + (probs[CLASSES.indexOf("hentai")] ?? 0);
}

/** File à un seul traitement à la fois : l'inférence est coûteuse en CPU. */
let queue: Promise<void> = Promise.resolve();
let queued = 0;

function enqueue(task: () => Promise<void>): void {
  if (queued >= MAX_QUEUE) return;
  queued++;
  queue = queue
    .then(task)
    .catch((err: unknown) => logger.warn({ err }, "Analyse NSFW impossible"))
    .finally(() => {
      queued--;
    });
}

function isImage(attachment: Attachment): boolean {
  return Boolean(attachment.contentType?.startsWith("image/")) && attachment.size <= MAX_IMAGE_BYTES;
}

async function removeNsfw(message: Message<true>, what: string): Promise<void> {
  const deleted = await deleteQuietly(message);
  await recordIncident(message.guild, {
    type: "nsfw",
    actorId: message.author.id,
    targetId: message.author.id,
    summary: `${what} publié par <@${message.author.id}> dans ${message.channel}.`,
    measures: [deleted ? "Message supprimé" : "⚠️ Message non supprimé"],
    shareWithNetwork: false,
  });
}

/**
 * Retourne vrai si le message a été supprimé tout de suite (lien adulte).
 * Les images sont analysées en arrière-plan et supprimées après coup.
 */
export async function checkNsfw(message: Message<true>, cfg: GuildConfig): Promise<boolean> {
  if ("nsfw" in message.channel && message.channel.nsfw) return false;
  if (!(await moduleEnabled(message.guildId, "nsfw"))) return false;

  const hosts = extractUrls(message.content)
    .map(hostOf)
    .filter((h): h is string => h !== null);
  if (hosts.some((h) => ADULT_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`)))) {
    await removeNsfw(message, "Lien vers un site adulte");
    return true;
  }

  if (!imageAnalysisConfigured || !cfg.nsfwImages) return false;
  const images = [...message.attachments.values()].filter(isImage);
  if (!images.length) return false;
  const threshold = cfg.nsfwThreshold / 100;
  enqueue(async () => {
    for (const image of images) {
      const score = await scoreImage(image.url);
      if (score === null || score < threshold) continue;
      await removeNsfw(message, `Image explicite (score ${Math.round(score * 100)} %)`);
      return;
    }
  });
  return false;
}
