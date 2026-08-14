import type { GuildMember } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { botInviteStats } from "../../db/schema";
import { brandEmbed } from "../../lib/embeds";
import { logger } from "../../lib/logger";

/** Total d'invitations affiché : arrivées − départs + ajustements manuels. */
export async function inviteTotal(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select()
    .from(botInviteStats)
    .where(and(eq(botInviteStats.guildId, guildId), eq(botInviteStats.userId, userId)))
    .limit(1);
  if (!row) return 0;
  return Math.max(0, row.joins - row.leaves + row.seedUses + row.bonus);
}

/**
 * Annonce « X a été invité par Y » dans le salon configuré.
 *
 * Appelée après l'enregistrement de l'arrivée, donc le total inclut déjà le
 * nouvel arrivant. Muette si aucun salon n'est configuré, et sans conséquence
 * en cas d'échec : une annonce ratée ne doit pas casser l'arrivée.
 */
export async function announceInvite(
  member: GuildMember,
  inviterId: string | null,
  isVanity: boolean,
): Promise<void> {
  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.inviteChannelId) return;

  const channel = await member.guild.channels
    .fetch(cfg.inviteChannelId)
    .catch(() => null);
  if (!channel?.isSendable()) return;

  const accountAge = `<t:${Math.floor(member.user.createdTimestamp / 1_000)}:R>`;

  let description: string;
  if (inviterId) {
    const total = await inviteTotal(member.guild.id, inviterId);
    description = [
      `📨 ${member} a rejoint le serveur, invité par <@${inviterId}>.`,
      `<@${inviterId}> en est à **${total}** invitation${total > 1 ? "s" : ""}.`,
    ].join("\n");
  } else if (isVanity) {
    description = `📨 ${member} a rejoint le serveur par l'URL personnalisée.`;
  } else {
    description = `📨 ${member} a rejoint le serveur — invitation inconnue.`;
  }

  await channel
    .send({
      embeds: [
        brandEmbed()
          .setAuthor({
            name: member.user.tag,
            iconURL: member.user.displayAvatarURL({ size: 64 }),
          })
          .setDescription(`${description}\n\n_Compte créé ${accountAge}._`)
          .setTimestamp(),
      ],
    })
    .catch((err) =>
      logger.warn({ err, guildId: member.guild.id }, "Annonce d'invitation impossible"),
    );
}
