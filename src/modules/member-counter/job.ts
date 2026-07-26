import type { Guild } from "discord.js";
import type { CloverClient } from "../../client";
import { getGuildConfig } from "../../db/guild-config";
import { renameCounterChannel } from "../../lib/counter-channel";

/** Nombre de membres humains (les bots ne sont pas comptés). */
export async function countHumanMembers(guild: Guild): Promise<number> {
  // Le cache n'est complet qu'après un fetch : sinon on compterait moins de
  // membres que la réalité. Les événements guildMemberAdd/Remove le
  // maintiennent ensuite à jour tout seuls.
  if (guild.members.cache.size < guild.memberCount) {
    await guild.members.fetch();
  }
  return guild.members.cache.filter((member) => !member.user.bot).size;
}

/**
 * Job (6 min — Discord limite les renommages à 2 par 10 min et par salon) :
 * met à jour le salon vocal affichant le nombre de membres du serveur.
 */
export async function tickMemberCounter(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.memberCounterChannelId) continue;

    const count = await countHumanMembers(guild);
    await renameCounterChannel(
      guild,
      cfg.memberCounterChannelId,
      cfg.memberCounterTemplate.replaceAll("{count}", String(count)),
      "Compteur de membres Discord",
    );
  }
}
