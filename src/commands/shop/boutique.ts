import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { brandEmbed, errorEmbed } from "../../lib/embeds";
import { fetchBalance, fetchCatalogue } from "../../lib/site-api";
import { buildPurchasePrompt, buildShopReply } from "../../modules/shop/manager";
import type { Command } from "../../types";

const boutique: Command = {
  data: new SlashCommandBuilder()
    .setName("boutique")
    .setDescription("Boutique et crédits Clover Games")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName("voir").setDescription("Afficher les articles payables en crédits"),
    )
    .addSubcommand((s) =>
      s.setName("solde").setDescription("Afficher ton solde de crédits"),
    )
    .addSubcommand((s) =>
      s
        .setName("acheter")
        .setDescription("Acheter un article avec tes crédits")
        .addStringOption((o) =>
          o
            .setName("article")
            .setDescription("Article à acheter")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === "voir") {
      const { embeds } = await buildShopReply(interaction.user.id);
      await interaction.editReply({ embeds });
      return;
    }

    if (sub === "solde") {
      const balance = await fetchBalance(interaction.user.id);
      await interaction.editReply({
        embeds: [
          balance.ok
            ? brandEmbed()
                .setTitle("🪙 Tes crédits")
                .setDescription(
                  `**${balance.data.balance}** crédits sur \`${balance.data.minecraftUsername}\`.`,
                )
                .setFooter({
                  text: "Les crédits se gagnent en jouant, en votant et en parrainant.",
                })
            : errorEmbed(balance.error),
        ],
      });
      return;
    }

    // acheter
    const { embeds, components } = await buildPurchasePrompt(
      interaction.user.id,
      interaction.options.getString("article", true),
    );
    await interaction.editReply({ embeds, components: components ?? [] });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const catalogue = await fetchCatalogue();
    if (!catalogue.ok) {
      await interaction.respond([]);
      return;
    }
    await interaction.respond(
      catalogue.data.products
        .filter((p) => p.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((p) => ({
          name: `${p.name} — ${p.credits} crédits`.slice(0, 100),
          value: p.id,
        })),
    );
  },
};

export default boutique;
