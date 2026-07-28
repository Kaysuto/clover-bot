import {
  AuditLogEvent,
  ChannelType,
  type Invite,
  type NonThreadGuildBasedChannel,
  type Role,
} from "discord.js";
import { getGuildConfig } from "../../db/guild-config";
import { auditFooter, findAuditEntry } from "./audit";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, trim } from "./format";

const CHANNEL_TYPE_LABEL: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "textuel",
  [ChannelType.GuildVoice]: "vocal",
  [ChannelType.GuildCategory]: "catégorie",
  [ChannelType.GuildAnnouncement]: "annonces",
  [ChannelType.GuildStageVoice]: "conférence",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildMedia]: "média",
};

function typeLabel(channel: NonThreadGuildBasedChannel): string {
  return CHANNEL_TYPE_LABEL[channel.type] ?? "salon";
}

/**
 * Les vocaux temporaires sont créés/supprimés/renommés en permanence par le
 * bot : les journaliser noierait les vraies modifications du serveur.
 */
async function isTempVoiceChurn(channel: NonThreadGuildBasedChannel): Promise<boolean> {
  const cfg = await getGuildConfig(channel.guild.id);
  return Boolean(cfg.tempvoiceCategoryId) && channel.parentId === cfg.tempvoiceCategoryId;
}

export async function logChannelCreate(
  channel: NonThreadGuildBasedChannel,
): Promise<void> {
  if (await isTempVoiceChurn(channel)) return;
  const entry = await findAuditEntry(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id,
  );

  await sendLog(
    channel.guild,
    "serveur",
    logEmbed(LOG_COLOR.add, "📁 Salon créé").setDescription(
      `${channel} · \`${channel.name}\` (${typeLabel(channel)})${auditFooter(entry)}`,
    ),
  );
}

export async function logChannelDelete(
  channel: NonThreadGuildBasedChannel,
): Promise<void> {
  if (await isTempVoiceChurn(channel)) return;
  const entry = await findAuditEntry(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id,
  );

  await sendLog(
    channel.guild,
    "serveur",
    logEmbed(LOG_COLOR.remove, "🗑️ Salon supprimé").setDescription(
      `\`${channel.name}\` (${typeLabel(channel)})${auditFooter(entry)}`,
    ),
  );
}

export async function logChannelUpdate(
  oldChannel: NonThreadGuildBasedChannel,
  newChannel: NonThreadGuildBasedChannel,
): Promise<void> {
  if (await isTempVoiceChurn(newChannel)) return;

  const changes: string[] = [];
  if (oldChannel.name !== newChannel.name) {
    changes.push(`**Nom** \`${oldChannel.name}\` → \`${newChannel.name}\``);
  }
  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push(
      `**Catégorie** ${oldChannel.parent?.name ?? "*aucune*"} → ${
        newChannel.parent?.name ?? "*aucune*"
      }`,
    );
  }
  if ("topic" in oldChannel && "topic" in newChannel && oldChannel.topic !== newChannel.topic) {
    changes.push(
      `**Sujet** ${oldChannel.topic ? `« ${oldChannel.topic} »` : "*aucun*"} → ${
        newChannel.topic ? `« ${newChannel.topic} »` : "*aucun*"
      }`,
    );
  }
  if (
    "rateLimitPerUser" in oldChannel &&
    "rateLimitPerUser" in newChannel &&
    oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser
  ) {
    changes.push(
      `**Mode lent** ${oldChannel.rateLimitPerUser ?? 0} s → ${newChannel.rateLimitPerUser ?? 0} s`,
    );
  }
  if ("nsfw" in oldChannel && "nsfw" in newChannel && oldChannel.nsfw !== newChannel.nsfw) {
    changes.push(`**NSFW** ${newChannel.nsfw ? "activé" : "désactivé"}`);
  }
  if (!changes.length) return; // permissions, position… : trop bruyant

  const entry = await findAuditEntry(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id,
  );

  await sendLog(
    newChannel.guild,
    "serveur",
    logEmbed(LOG_COLOR.update, "✏️ Salon modifié").setDescription(
      trim(`${newChannel}\n${changes.join("\n")}${auditFooter(entry)}`, 4000),
    ),
  );
}

export async function logRoleCreate(role: Role): Promise<void> {
  const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
  await sendLog(
    role.guild,
    "serveur",
    logEmbed(LOG_COLOR.add, "🎭 Rôle créé").setDescription(
      `${role} · \`${role.name}\`${auditFooter(entry)}`,
    ),
  );
}

export async function logRoleDelete(role: Role): Promise<void> {
  const entry = await findAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
  await sendLog(
    role.guild,
    "serveur",
    logEmbed(LOG_COLOR.remove, "🗑️ Rôle supprimé").setDescription(
      `\`${role.name}\` (${role.members.size} membre(s))${auditFooter(entry)}`,
    ),
  );
}

export async function logRoleUpdate(oldRole: Role, newRole: Role): Promise<void> {
  const changes: string[] = [];
  if (oldRole.name !== newRole.name) {
    changes.push(`**Nom** \`${oldRole.name}\` → \`${newRole.name}\``);
  }
  if (oldRole.hexColor !== newRole.hexColor) {
    changes.push(`**Couleur** ${oldRole.hexColor} → ${newRole.hexColor}`);
  }
  if (oldRole.hoist !== newRole.hoist) {
    changes.push(`**Affiché séparément** ${newRole.hoist ? "oui" : "non"}`);
  }
  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`**Mentionnable** ${newRole.mentionable ? "oui" : "non"}`);
  }

  const oldPerms = oldRole.permissions.toArray();
  const newPerms = newRole.permissions.toArray();
  const gained = newPerms.filter((p) => !oldPerms.includes(p));
  const lost = oldPerms.filter((p) => !newPerms.includes(p));
  if (gained.length) {
    changes.push(`**Permissions ajoutées** \`${gained.join("`, `")}\``);
  }
  if (lost.length) {
    changes.push(`**Permissions retirées** \`${lost.join("`, `")}\``);
  }
  if (!changes.length) return;

  const entry = await findAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

  await sendLog(
    newRole.guild,
    "serveur",
    logEmbed(LOG_COLOR.update, "✏️ Rôle modifié").setDescription(
      trim(`${newRole}\n${changes.join("\n")}${auditFooter(entry)}`, 4000),
    ),
  );
}

export async function logInviteCreate(invite: Invite): Promise<void> {
  const guild = invite.guild;
  if (!guild || !("channels" in guild)) return; // InviteGuild (guilde partielle) : rien à journaliser

  const limits = [
    invite.maxUses ? `${invite.maxUses} utilisation(s)` : "illimitée",
    invite.expiresAt ? `expire <t:${Math.floor(invite.expiresAt.getTime() / 1_000)}:R>` : "sans expiration",
  ].join(" · ");

  await sendLog(
    guild,
    "serveur",
    logEmbed(LOG_COLOR.add, "🔗 Invitation créée").setDescription(
      `\`${invite.code}\`${invite.inviterId ? ` par <@${invite.inviterId}>` : ""}\n**Salon** <#${invite.channelId}>\n**Limites** ${limits}`,
    ),
  );
}

export async function logInviteDelete(invite: Invite): Promise<void> {
  const guild = invite.guild;
  if (!guild || !("channels" in guild)) return;

  await sendLog(
    guild,
    "serveur",
    logEmbed(LOG_COLOR.remove, "🔗 Invitation supprimée").setDescription(
      `\`${invite.code}\`${invite.inviterId ? ` de <@${invite.inviterId}>` : ""}`,
    ),
  );
}
