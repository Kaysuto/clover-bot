import type { Message } from "discord.js";
import type { CloverClient } from "../../client";
import { pool } from "../../db";
export async function recordMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  await pool.query(
    `INSERT INTO bot_dashboard_daily(guild_id,day,messages) VALUES($1,(now() AT TIME ZONE 'Europe/Paris')::date,1) ON CONFLICT(guild_id,day) DO UPDATE SET messages=bot_dashboard_daily.messages+1`,
    [message.guild.id],
  );
}
export async function sampleMembers(client: CloverClient) {
  for (const guild of client.guilds.cache.values())
    await pool.query(
      `INSERT INTO bot_dashboard_daily(guild_id,day,members,observed_at) VALUES($1,(now() AT TIME ZONE 'Europe/Paris')::date,$2,now()) ON CONFLICT(guild_id,day) DO UPDATE SET members=$2,observed_at=now()`,
      [guild.id, guild.memberCount],
    );
}
export async function recordAudit(
  guildId: string,
  actor: string,
  action: string,
) {
  await pool.query(
    "INSERT INTO bot_dashboard_audit(guild_id,actor_id,action) VALUES($1,$2,$3)",
    [guildId, actor, action],
  );
}
