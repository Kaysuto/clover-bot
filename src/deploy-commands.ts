import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { env } from "./config";

async function main(): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  console.log(`Déploiement de ${body.length} commandes…`);
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body },
  );
  console.log(`✅ ${body.length} commandes déployées sur la guilde ${env.DISCORD_GUILD_ID}`);
}

main().catch((err) => {
  console.error("❌ Échec du déploiement :", err);
  process.exit(1);
});
