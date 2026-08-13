import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { env } from "../../config";
import { brandEmbed } from "../../lib/embeds";
import { getLinkedAccount } from "../../modules/sync/manager";
import { countVotes, topVoters } from "../../modules/vote/manager";
import type { Command } from "../../types";

const MEDALS = ["🥇", "🥈", "🥉"];

const votes: Command = {
  data: new SlashCommandBuilder()
    .setName("votes")
    .setDescription("Classement des voteurs du mois")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Voir le total d'un membre en particulier"),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getUser("membre");
    if (target) {
      const linked = await getLinkedAccount(target.id);
      const total = linked ? await countVotes(linked.minecraftUsername) : 0;
      await interaction.editReply({
        embeds: [
          brandEmbed()
            .setTitle("🗳️ Votes")
            .setDescription(
              linked
                ? `${target} (\`${linked.minecraftUsername}\`) totalise **${total}** vote(s).`
                : `${target} n'a pas de compte Minecraft lié : ses votes ne peuvent pas être comptés. Liaison avec \`/lier\`.`,
            ),
        ],
      });
      return;
    }

    const top = await topVoters(10);
    const embed = brandEmbed()
      .setTitle("🗳️ Voteurs du mois")
      .setFooter({ text: `Voter : ${env.WEBSITE_URL}` });

    if (!top.length) {
      embed.setDescription("Aucun vote ce mois-ci. À vous de jouer ! 🍀");
    } else {
      embed.setDescription(
        top
          .map((row, i) => {
            const rank = MEDALS[i] ?? `\`#${i + 1}\``;
            const who = row.discordId
              ? `<@${row.discordId}> (\`${row.username}\`)`
              : `\`${row.username}\``;
            return `${rank} ${who} — **${row.votes}** vote(s)`;
          })
          .join("\n"),
      );
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default votes;
