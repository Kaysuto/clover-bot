import type { GuildMember, VoiceChannel } from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { botTempVoice } from "../../db/schema";
import type { TempVoiceRow } from "./manager";

/**
 * Actions de gestion d'un vocal temporaire, partagées par les boutons du salon
 * texte et les sous-commandes `/voc` : une seule implémentation des règles.
 */
export interface ActionResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): ActionResult => ({ ok: true, message });
const ko = (message: string): ActionResult => ({ ok: false, message });

async function patchRow(
  row: TempVoiceRow,
  values: Partial<typeof botTempVoice.$inferInsert>,
): Promise<void> {
  await db
    .update(botTempVoice)
    .set(values)
    .where(eq(botTempVoice.voiceChannelId, row.voiceChannelId));
}

/** Garde-fou commun : tout sauf « Réclamer » est réservé au propriétaire. */
export function requireOwner(row: TempVoiceRow, userId: string): ActionResult | null {
  if (row.ownerId === userId) return null;
  return ko(
    "Seul le propriétaire du vocal peut faire ça — utilise « Réclamer » (ou `/voc claim`) s'il a quitté le salon.",
  );
}

export async function lockVoice(
  voice: VoiceChannel,
  row: TempVoiceRow,
): Promise<ActionResult> {
  await voice.permissionOverwrites.edit(voice.guild.roles.everyone, {
    Connect: false,
  });
  await patchRow(row, { locked: true });
  return ok("Vocal verrouillé 🔒 — plus personne ne peut rejoindre.");
}

export async function unlockVoice(
  voice: VoiceChannel,
  row: TempVoiceRow,
): Promise<ActionResult> {
  await voice.permissionOverwrites.edit(voice.guild.roles.everyone, {
    Connect: null,
  });
  await patchRow(row, { locked: false });
  return ok("Vocal déverrouillé 🔓 — tout le monde peut rejoindre.");
}

export async function setVoiceLimit(
  voice: VoiceChannel,
  row: TempVoiceRow,
  limit: number,
): Promise<ActionResult> {
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
    return ko("Indique un nombre entre **0** et **99** (0 = illimité).");
  }
  await voice.setUserLimit(limit);
  await patchRow(row, { userLimit: limit });
  return ok(
    limit === 0
      ? "Limite retirée — places illimitées."
      : `Limite fixée à **${limit}** place(s).`,
  );
}

export async function renameVoice(
  voice: VoiceChannel,
  name: string,
): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return ko("Le nom ne peut pas être vide.");
  try {
    await voice.setName(`🔊 ${clean}`.slice(0, 100));
    return ok(`Vocal renommé en **🔊 ${clean}**.`);
  } catch {
    return ko(
      "Renommage impossible — Discord limite à 2 renommages par 10 minutes par salon.",
    );
  }
}

export async function kickFromVoice(
  voice: VoiceChannel,
  row: TempVoiceRow,
  target: GuildMember,
): Promise<ActionResult> {
  if (target.voice.channelId !== voice.id) {
    return ko("Ce membre n'est pas dans ton vocal.");
  }
  if (target.id === row.ownerId) return ko("Tu ne peux pas t'expulser toi-même.");
  await target.voice.disconnect("Expulsé par le propriétaire du vocal");
  return ok(`**${target.displayName}** a été expulsé du vocal.`);
}

export async function transferVoice(
  voice: VoiceChannel,
  row: TempVoiceRow,
  target: GuildMember,
): Promise<ActionResult> {
  if (target.voice.channelId !== voice.id) {
    return ko("Le nouveau propriétaire doit être dans ton vocal.");
  }
  if (target.user.bot || target.id === row.ownerId) {
    return ko("Choisis un autre membre (humain) du vocal.");
  }
  await transferOwnership(voice, row, target.id);
  return ok(`👑 **${target.displayName}** est maintenant propriétaire du vocal.`);
}

/** Récupération de la propriété : le seul cas ouvert aux non-propriétaires. */
export async function claimVoice(
  voice: VoiceChannel,
  row: TempVoiceRow,
  member: GuildMember,
): Promise<ActionResult> {
  if (row.ownerId === member.id) return ko("Tu es déjà le propriétaire de ce vocal.");
  if (voice.members.has(row.ownerId)) {
    return ko("Le propriétaire est encore dans le vocal.");
  }
  await transferOwnership(voice, row, member.id);
  return ok("Tu es maintenant propriétaire de ce vocal ! 👑");
}

/** Déplace les droits (vocal + salon texte) de l'ancien vers le nouveau propriétaire. */
async function transferOwnership(
  voice: VoiceChannel,
  row: TempVoiceRow,
  newOwnerId: string,
): Promise<void> {
  await patchRow(row, { ownerId: newOwnerId });

  await voice.permissionOverwrites.delete(row.ownerId).catch(() => undefined);
  await voice.permissionOverwrites
    .edit(newOwnerId, { ViewChannel: true, Connect: true, MoveMembers: true })
    .catch(() => undefined);

  const text = voice.guild.channels.cache.get(row.textChannelId);
  if (text && "permissionOverwrites" in text) {
    await text.permissionOverwrites
      .edit(newOwnerId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      })
      .catch(() => undefined);
  }
}
