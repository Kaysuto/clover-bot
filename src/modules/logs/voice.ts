import type { VoiceState } from "discord.js";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, userLine } from "./format";

/**
 * Connexions, déconnexions et déplacements vocaux. Les changements de micro
 * (mute/sourdine) sont volontairement ignorés : beaucoup trop bruyants.
 */
export async function logVoiceUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return;

  const embed = !oldState.channelId
    ? logEmbed(LOG_COLOR.add, "🔊 Connexion vocale").setDescription(
        `${userLine(member.user)}\n**Salon** <#${newState.channelId}>`,
      )
    : !newState.channelId
      ? logEmbed(LOG_COLOR.remove, "🔇 Déconnexion vocale").setDescription(
          `${userLine(member.user)}\n**Salon** <#${oldState.channelId}>`,
        )
      : logEmbed(LOG_COLOR.update, "🔀 Changement de salon vocal").setDescription(
          `${userLine(member.user)}\n<#${oldState.channelId}> → <#${newState.channelId}>`,
        );

  await sendLog(member.guild, "vocal", embed);
}
