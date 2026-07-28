import { AuditLogEvent, type GuildBan } from "discord.js";
import { auditFooter, findAuditEntry } from "./audit";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, timestamp, userLine } from "./format";

/** 🔨 Bannissement (auteur et raison via les logs d'audit). */
export async function logBanAdd(ban: GuildBan): Promise<void> {
  const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, {
    maxAgeMs: 15_000,
  });
  const reason = ban.reason ?? entry?.reason ?? null;

  await sendLog(
    ban.guild,
    "moderation",
    logEmbed(LOG_COLOR.remove, "🔨 Membre banni")
      .setDescription(
        `${userLine(ban.user)}${auditFooter({
          executorId: entry?.executorId ?? null,
          reason,
        })}`,
      )
      .setThumbnail(ban.user.displayAvatarURL())
      .addFields({ name: "Compte créé", value: timestamp(ban.user.createdAt) })
      .setFooter({ text: `ID ${ban.user.id}` }),
  );
}

/** 🕊️ Débannissement. */
export async function logBanRemove(ban: GuildBan): Promise<void> {
  const entry = await findAuditEntry(
    ban.guild,
    AuditLogEvent.MemberBanRemove,
    ban.user.id,
    { maxAgeMs: 15_000 },
  );

  await sendLog(
    ban.guild,
    "moderation",
    logEmbed(LOG_COLOR.add, "🕊️ Membre débanni")
      .setDescription(`${userLine(ban.user)}${auditFooter(entry)}`)
      .setThumbnail(ban.user.displayAvatarURL())
      .setFooter({ text: `ID ${ban.user.id}` }),
  );
}
