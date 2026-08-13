import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { brandEmbed, errorEmbed } from "../../lib/embeds";
import { getServerStatus } from "../../lib/mc-status";
import { rconHealthCheck } from "../../lib/rcon";
import { getServer, getServers, serverAddress } from "../../lib/servers";
import { buildStatusEmbed } from "../../modules/status/monitor";
import type { Command } from "../../types";

const statut: Command = {
  data: new SlashCommandBuilder()
    .setName("statut")
    .setDescription("Affiche l'état des services Clover Games (site, Minecraft)")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("serveur")
        .setDescription("Détail d'un serveur du réseau")
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    const key = interaction.options.getString("serveur");
    if (!key) {
      await interaction.reply({
        embeds: [buildStatusEmbed(interaction.client)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const server = await getServer(key);
    if (!server) {
      await interaction.reply({
        embeds: [errorEmbed(`Aucun serveur actif ne porte la clé \`${key}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [status, rcon] = await Promise.all([
      getServerStatus(server, true),
      rconHealthCheck(server.key),
    ]);

    const embed = brandEmbed()
      .setTitle(`${server.emoji} ${server.label}`)
      .addFields(
        {
          name: "État",
          value: status.online ? "🟢 En ligne" : "🔴 Hors ligne",
          inline: true,
        },
        {
          name: "Joueurs",
          value: status.online ? `${status.players} / ${status.maxPlayers}` : "—",
          inline: true,
        },
        {
          name: "Latence",
          value: status.latencyMs !== null ? `${status.latencyMs} ms` : "—",
          inline: true,
        },
        { name: "Adresse", value: `\`${serverAddress(server)}\``, inline: true },
        {
          name: "Version",
          value: status.version ?? "—",
          inline: true,
        },
        {
          name: "RCON",
          value: !rcon.configured
            ? "⚪ Non configuré"
            : rcon.ok
              ? `🟢 ${rcon.latencyMs} ms`
              : "🔴 Injoignable",
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction) {
    await interaction.respond(await serverChoices(interaction.options.getFocused()));
  },
};

/** Choix « Serveur (clé) » filtrés sur la saisie, plafonnés à 25 par Discord. */
export async function serverChoices(
  focused: string,
): Promise<Array<{ name: string; value: string }>> {
  const query = focused.toLowerCase();
  const servers = await getServers().catch(() => []);
  return servers
    .filter(
      (s) =>
        s.key.includes(query) || s.label.toLowerCase().includes(query),
    )
    .slice(0, 25)
    .map((s) => ({ name: `${s.emoji} ${s.label}`, value: s.key }));
}

export default statut;
