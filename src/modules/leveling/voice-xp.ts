import type { VoiceState } from "discord.js";
import type { CloverClient } from "../../client";
import { getGuildConfig } from "../../db/guild-config";
import { grantXp } from "./xp";

/**
 * Job (60 s) : crédite l'XP vocal. Conditions anti-farm :
 * pas de bot, pas muet/sourd, hors salon AFK, au moins 2 humains dans le
 * salon. Aucune session à maintenir : on lit l'état vocal courant, ce qui
 * survit naturellement aux redémarrages.
 */
export async function tickVoiceXp(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (cfg.voiceXpPerMin <= 0) continue;

    const byChannel = new Map<string, VoiceState[]>();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || !state.member || state.member.user.bot) continue;
      if (state.channelId === guild.afkChannelId) continue;
      const list = byChannel.get(state.channelId) ?? [];
      list.push(state);
      byChannel.set(state.channelId, list);
    }

    for (const states of byChannel.values()) {
      if (states.length < 2) continue; // seul en vocal = pas d'XP
      for (const state of states) {
        if (state.mute || state.deaf) continue;
        await grantXp(guild, state.id, cfg.voiceXpPerMin, {
          cfg,
          fromVoiceMinute: true,
        });
      }
    }
  }
}
