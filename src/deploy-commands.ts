import { REST, Routes } from "discord.js";
import { cloverCommands, commands, publicCommands } from "./commands";
import { cloverGuildIds, env } from "./config";

async function main(): Promise<void> {
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  if (env.DEV_GUILD_ID) {
    const body = commands.map((command) => command.data.toJSON());
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DEV_GUILD_ID),
      { body },
    );
    console.log(`✅ ${body.length} commandes déployées sur la guilde de développement`);
    return;
  }

  const publicBody = publicCommands.map((command) => command.data.toJSON());
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
    body: publicBody,
  });
  for (const guildId of cloverGuildIds) {
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId),
      { body: cloverCommands.map((command) => command.data.toJSON()) },
    );
  }
  console.log(`✅ ${publicBody.length} commandes globales déployées`);
}

main().catch((err) => {
  console.error("❌ Échec du déploiement :", err);
  process.exit(1);
});
