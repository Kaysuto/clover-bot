import type { GuildMember, PartialGuildMember } from "discord.js";
import type { CloverClient } from "../../client";
import { isCloverGuild, luckPermsConfigured } from "../../config";
import { dashedUuid, getGroupHolders } from "../../lib/lp-db";
import { logger } from "../../lib/logger";
import { rconCommand } from "../../lib/rcon";
import { getLinkedAccount } from "../sync/manager";

/**
 * Grade Propulseur = boost d'un serveur Discord Clover. Le groupe LuckPerms
 * `propulseur` est géré par le bot seul : il est ajouté en plus du grade du
 * joueur (`parent add`, jamais `parent set`) et retiré à la fin du boost.
 *
 * Deux chemins : l'événement `guildMemberUpdate` pour la réactivité, et le job
 * de réconciliation pour tout ce que l'événement rate (bot hors ligne, membre
 * parti, liaison faite après le boost, membre absent du cache).
 */
export const PROPULSEUR_GROUP = "propulseur";

/** LuckPerms est en MySQL partagé : une commande sur le serveur par défaut vaut partout. */
function setPropulseur(uuid: string, granted: boolean): Promise<string | null> {
  const action = granted ? "add" : "remove";
  return rconCommand(`lp user ${dashedUuid(uuid)} parent ${action} ${PROPULSEUR_GROUP}`);
}

async function linkedUuid(discordId: string): Promise<string | null> {
  const linked = await getLinkedAccount(discordId).catch(() => null);
  return linked?.minecraftUuid ? dashedUuid(linked.minecraftUuid).toLowerCase() : null;
}

/** Début ou fin de boost. Un membre non lié est rattrapé par le job après `/lier`. */
export async function handlePropulseurChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (!isCloverGuild(newMember.guild.id)) return;
  const wasBoosting = Boolean(oldMember.premiumSince);
  const isBoosting = Boolean(newMember.premiumSince);
  if (wasBoosting === isBoosting) return;
  // Membre ancien absent du cache : on ne sait pas s'il boostait déjà, le job tranchera.
  if (oldMember.partial && !isBoosting) return;

  // Un autre serveur Clover peut encore porter le boost : c'est l'union qui compte.
  if (!isBoosting && (await boostsAnyCloverGuild(newMember))) return;

  const uuid = await linkedUuid(newMember.id);
  if (!uuid) return;
  const done = await setPropulseur(uuid, isBoosting);
  logger.info(
    { userId: newMember.id, uuid, granted: isBoosting, applied: done !== null },
    "Grade Propulseur mis à jour",
  );
}

async function boostsAnyCloverGuild(member: GuildMember): Promise<boolean> {
  for (const guild of member.client.guilds.cache.values()) {
    if (!isCloverGuild(guild.id)) continue;
    const other = await guild.members.fetch(member.id).catch(() => null);
    if (other?.premiumSince) return true;
  }
  return false;
}

/**
 * Aligne le groupe `propulseur` sur la liste des boosters liés. N'écrit rien si
 * une seule source est illisible : une lecture partielle retirerait le grade à
 * de vrais boosters.
 */
export async function tickPropulseurSync(client: CloverClient): Promise<void> {
  if (!luckPermsConfigured) return;

  const boosters = new Set<string>();
  for (const guild of client.guilds.cache.values()) {
    if (!isCloverGuild(guild.id)) continue;
    const members = await guild.members.fetch().catch((err) => {
      logger.warn({ err, guildId: guild.id }, "Membres illisibles : synchro Propulseur reportée");
      return null;
    });
    if (!members) return;
    for (const member of members.values()) {
      if (!member.premiumSince || member.user.bot) continue;
      const uuid = await linkedUuid(member.id);
      if (uuid) boosters.add(uuid);
    }
  }

  const holders = await getGroupHolders(PROPULSEUR_GROUP);
  if (!holders) return;
  const current = new Set(holders.map((uuid) => uuid.toLowerCase()));

  const toGrant = [...boosters].filter((uuid) => !current.has(uuid));
  const toRevoke = [...current].filter((uuid) => !boosters.has(uuid));
  for (const uuid of toGrant) await setPropulseur(uuid, true);
  for (const uuid of toRevoke) await setPropulseur(uuid, false);

  if (toGrant.length || toRevoke.length) {
    logger.info(
      { granted: toGrant.length, revoked: toRevoke.length, boosters: boosters.size },
      "Synchro Propulseur terminée",
    );
  }
}
