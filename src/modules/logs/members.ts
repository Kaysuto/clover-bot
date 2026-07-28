import {
  AuditLogEvent,
  type Client,
  type EmbedBuilder,
  type GuildMember,
  type PartialGuildMember,
  type PartialUser,
  type User,
} from "discord.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { botInviteJoins } from "../../db/schema";
import { formatDuration } from "../../lib/duration";
import { auditFooter, findAuditEntry } from "./audit";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, timestamp, trim, userLine } from "./format";

/** Un compte plus récent que ça mérite un coup d'œil (raid, multicompte). */
const NEW_ACCOUNT_MS = 7 * 86_400_000;

/** 📥 Arrivée : âge du compte + invitation utilisée. */
export async function logMemberJoin(member: GuildMember): Promise<void> {
  const createdAt = member.user.createdAt;
  const isNew = Date.now() - createdAt.getTime() < NEW_ACCOUNT_MS;

  const embed = logEmbed(
    isNew ? LOG_COLOR.warn : LOG_COLOR.add,
    member.user.bot ? "🤖 Bot ajouté" : "📥 Arrivée d'un membre",
  )
    .setDescription(userLine(member.user))
    .setThumbnail(member.user.displayAvatarURL())
    .addFields({
      name: "Compte créé",
      value: isNew
        ? `${timestamp(createdAt)}\n⚠️ **Compte de moins de 7 jours**`
        : timestamp(createdAt),
    })
    .setFooter({ text: `ID ${member.id} • ${member.guild.memberCount} membres` });

  const invite = await describeInvite(member);
  if (invite) embed.addFields({ name: "Invitation", value: invite });

  await sendLog(member.guild, "membres", embed);
}

/** 📤 Départ — ou 👢 expulsion si les logs d'audit l'attestent. */
export async function logMemberLeave(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const guild = member.guild;

  // Un bannissement déclenche aussi guildMemberRemove : c'est guildBanAdd qui
  // le journalise, on ne double pas l'entrée.
  const ban = await findAuditEntry(guild, AuditLogEvent.MemberBanAdd, member.id, {
    maxAgeMs: 5_000,
  });
  if (ban) return;

  const kick = await findAuditEntry(guild, AuditLogEvent.MemberKick, member.id, {
    maxAgeMs: 5_000,
    delayMs: 0, // l'attente a déjà eu lieu pour la recherche de bannissement
  });

  const roles = member.partial
    ? []
    : member.roles.cache
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => `<@&${role.id}>`);

  const embed = logEmbed(
    LOG_COLOR.remove,
    kick ? "👢 Membre expulsé" : "📤 Départ d'un membre",
  )
    .setDescription(`${userLine(member.user)}${kick ? auditFooter(kick) : ""}`)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `ID ${member.id} • ${guild.memberCount} membres` });

  if (member.joinedAt) {
    embed.addFields({
      name: "Avait rejoint",
      value: `${timestamp(member.joinedAt)}\nSoit **${formatDuration(
        Date.now() - member.joinedAt.getTime(),
      )}** sur le serveur`,
    });
  }
  if (roles.length) {
    embed.addFields({ name: `Rôles (${roles.length})`, value: trim(roles.join(" ")) });
  }

  await sendLog(guild, kick ? "moderation" : "membres", embed);
}

/** Pseudo serveur, rôles, boost, exclusion temporaire. */
export async function logMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (oldMember.partial) return; // sans état précédent, aucune comparaison fiable
  const guild = newMember.guild;

  if (oldMember.nickname !== newMember.nickname) {
    await sendLog(
      guild,
      "membres",
      logEmbed(LOG_COLOR.update, "✏️ Pseudo serveur modifié")
        .setDescription(userLine(newMember.user))
        .addFields(
          { name: "Avant", value: oldMember.nickname ?? "*aucun*", inline: true },
          { name: "Après", value: newMember.nickname ?? "*aucun*", inline: true },
        ),
    );
  }

  const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
  if (added.size || removed.size) {
    const embed = logEmbed(LOG_COLOR.update, "🎭 Rôles modifiés").setDescription(
      userLine(newMember.user),
    );
    if (added.size) {
      embed.addFields({
        name: "Ajoutés",
        value: trim(added.map((r) => `<@&${r.id}>`).join(" ")),
      });
    }
    if (removed.size) {
      embed.addFields({
        name: "Retirés",
        value: trim(removed.map((r) => `<@&${r.id}>`).join(" ")),
      });
    }
    await sendLog(guild, "membres", embed);
  }

  if (!oldMember.premiumSince && newMember.premiumSince) {
    await sendLog(
      guild,
      "membres",
      logEmbed(LOG_COLOR.add, "💎 Nouveau boost du serveur").setDescription(
        `${userLine(newMember.user)} boost le serveur — merci !`,
      ),
    );
  } else if (oldMember.premiumSince && !newMember.premiumSince) {
    await sendLog(
      guild,
      "membres",
      logEmbed(LOG_COLOR.remove, "💔 Boost retiré").setDescription(
        userLine(newMember.user),
      ),
    );
  }

  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;
  if (oldTimeout !== newTimeout) {
    const entry = await findAuditEntry(
      guild,
      AuditLogEvent.MemberUpdate,
      newMember.id,
      { maxAgeMs: 5_000 },
    );
    const active = newTimeout !== null && newTimeout > Date.now();
    await sendLog(
      guild,
      "moderation",
      logEmbed(
        active ? LOG_COLOR.remove : LOG_COLOR.add,
        active ? "🔇 Exclusion temporaire" : "🔊 Exclusion temporaire levée",
      ).setDescription(
        `${userLine(newMember.user)}${
          active ? `\n**Jusqu'au** ${timestamp(newTimeout)}` : ""
        }${auditFooter(entry)}`,
      ),
    );
  }
}

/** Photo de profil, nom d'utilisateur, nom affiché (global à Discord). */
export async function logUserUpdate(
  client: Client,
  oldUser: User | PartialUser,
  newUser: User,
): Promise<void> {
  if (oldUser.partial || newUser.bot) return;

  const embeds: EmbedBuilder[] = [];

  if (oldUser.avatar !== newUser.avatar) {
    const action = !oldUser.avatar
      ? "ajoutée"
      : !newUser.avatar
        ? "retirée"
        : "modifiée";
    const embed = logEmbed(LOG_COLOR.update, `🖼️ Photo de profil ${action}`)
      .setDescription(
        `${userLine(newUser)}\n[Ancienne photo](${oldUser.displayAvatarURL({ size: 256 })})`,
      )
      .setThumbnail(newUser.displayAvatarURL({ size: 256 }));
    embeds.push(embed);
  }

  if (oldUser.username !== newUser.username) {
    embeds.push(
      logEmbed(LOG_COLOR.update, "🏷️ Nom d'utilisateur modifié")
        .setDescription(userLine(newUser))
        .addFields(
          { name: "Avant", value: `\`@${oldUser.username}\``, inline: true },
          { name: "Après", value: `\`@${newUser.username}\``, inline: true },
        ),
    );
  }

  if (oldUser.globalName !== newUser.globalName) {
    embeds.push(
      logEmbed(LOG_COLOR.update, "🏷️ Nom affiché modifié")
        .setDescription(userLine(newUser))
        .addFields(
          { name: "Avant", value: oldUser.globalName ?? "*aucun*", inline: true },
          { name: "Après", value: newUser.globalName ?? "*aucun*", inline: true },
        ),
    );
  }
  if (!embeds.length) return;

  // userUpdate est global : on ne journalise que dans les serveurs où il est membre.
  for (const guild of client.guilds.cache.values()) {
    if (!guild.members.cache.has(newUser.id)) continue;
    for (const embed of embeds) await sendLog(guild, "membres", embed);
  }
}

/** « `code` par @inviteur » d'après le journal d'invitations. */
async function describeInvite(member: GuildMember): Promise<string | null> {
  if (member.user.bot) return null;

  const [join] = await db
    .select()
    .from(botInviteJoins)
    .where(
      and(
        eq(botInviteJoins.guildId, member.guild.id),
        eq(botInviteJoins.memberId, member.id),
        isNull(botInviteJoins.leftAt),
      ),
    )
    .orderBy(desc(botInviteJoins.joinedAt))
    .limit(1);
  if (!join) return null;

  if (join.isVanity) return `URL personnalisée \`${join.code ?? "?"}\``;
  if (!join.inviterId) return "*inconnue*";
  return `\`${join.code ?? "?"}\` par <@${join.inviterId}>`;
}
