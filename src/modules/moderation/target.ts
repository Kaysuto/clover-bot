import type { Guild, GuildMember, User } from "discord.js";
export async function targetRefusal(
  guild: Guild,
  moderator: GuildMember,
  target: User,
): Promise<string | null> {
  if (target.id === moderator.id)
    return "Tu ne peux pas te sanctionner toi-même.";
  if (target.id === guild.client.user.id)
    return "Je ne peux pas me sanctionner.";
  if (target.id === guild.ownerId)
    return "Le propriétaire du serveur ne peut pas être sanctionné.";
  const member = await guild.members.fetch(target.id).catch(() => null);
  if (!member) return null;
  if (
    member.roles.highest.position >= moderator.roles.highest.position &&
    moderator.id !== guild.ownerId
  )
    return "Ce membre a un rôle supérieur ou égal au tien.";
  const me = await guild.members.fetchMe();
  if (member.roles.highest.position >= me.roles.highest.position)
    return "Ce membre a un rôle supérieur ou égal au mien.";
  return null;
}
