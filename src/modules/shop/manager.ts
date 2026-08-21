import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import {
  fetchBalance,
  fetchCatalogue,
  purchase,
  type SiteProduct,
} from "../../lib/site-api";
import type { ComponentHandler } from "../../types";

/**
 * Boutique Discord — vitrine du catalogue du site.
 *
 * Le bot n'a ni catalogue ni solde à lui : il interroge le site, qui reste
 * seul à débiter les pièces, exécuter les commandes RCON du produit et tracer
 * la commande. Ici, on n'écrit rien.
 */

const CATEGORY_LABELS: Record<string, string> = {
  grade: "🏅 Grades",
  grades: "🏅 Grades",
  cosmétique: "🎨 Cosmétiques",
  cosmetique: "🎨 Cosmétiques",
  avantage: "⚡ Avantages",
  autre: "📦 Divers",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category.toLowerCase()] ?? `📦 ${category}`;
}

/** Vitrine groupée par catégorie, prix en pièces et en euros. */
export async function buildShopReply(discordId: string) {
  const catalogue = await fetchCatalogue();
  if (!catalogue.ok) {
    return { embeds: [errorEmbed(catalogue.error)], flags: MessageFlags.Ephemeral };
  }
  if (!catalogue.data.products.length) {
    return {
      embeds: [errorEmbed("Aucun article n'est payable en pièces pour le moment.")],
      flags: MessageFlags.Ephemeral,
    };
  }

  const balance = await fetchBalance(discordId);
  const embed = brandEmbed()
    .setTitle("🛒 Boutique Clover Games")
    .setDescription(
      balance.ok
        ? `Ton solde : **${balance.data.balance}** pièces (\`${balance.data.minecraftUsername}\`).`
        : `⚠️ ${balance.error}`,
    );

  const byCategory = new Map<string, SiteProduct[]>();
  for (const product of catalogue.data.products) {
    const list = byCategory.get(product.category) ?? [];
    list.push(product);
    byCategory.set(product.category, list);
  }

  for (const [category, products] of byCategory) {
    embed.addFields({
      name: categoryLabel(category),
      value: products
        .map(
          (p) =>
            `**${p.name}** — \`${p.credits}\` pièces _(${(p.priceCents / 100).toFixed(2)} €)_`,
        )
        .join("\n")
        .slice(0, 1_024),
    });
  }

  embed.setFooter({
    text: "Achat : /acheter article:<nom>. Les pièces se gagnent en jouant, en votant et en parrainant.",
  });

  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

/** Demande de confirmation avant tout débit. */
export async function buildPurchasePrompt(discordId: string, productId: string) {
  const catalogue = await fetchCatalogue();
  if (!catalogue.ok) {
    return { embeds: [errorEmbed(catalogue.error)], flags: MessageFlags.Ephemeral };
  }

  const product = catalogue.data.products.find((p) => p.id === productId);
  if (!product) {
    return {
      embeds: [errorEmbed("Cet article n'existe plus ou n'est pas payable en pièces.")],
      flags: MessageFlags.Ephemeral,
    };
  }

  const balance = await fetchBalance(discordId);
  if (!balance.ok) {
    return { embeds: [errorEmbed(balance.error)], flags: MessageFlags.Ephemeral };
  }
  if (balance.data.balance < product.credits) {
    return {
      embeds: [
        errorEmbed(
          `Solde insuffisant : **${product.credits}** pièces requises, **${balance.data.balance}** disponibles.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    };
  }

  return {
    embeds: [
      brandEmbed()
        .setTitle(`🛒 ${product.name}`)
        .setDescription(product.description ?? "Aucune description.")
        .addFields(
          { name: "Prix", value: `**${product.credits}** pièces`, inline: true },
          { name: "Ton solde", value: `${balance.data.balance} pièces`, inline: true },
          {
            name: "Après achat",
            value: `${balance.data.balance - product.credits} pièces`,
            inline: true,
          },
        )
        .setFooter({
          text: `Livré à ${balance.data.minecraftUsername} · achat définitif, aucun remboursement`,
        }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId("shop", "buy", product.id))
          .setLabel(`Acheter pour ${product.credits} pièces`)
          .setEmoji("🪙")
          .setStyle(ButtonStyle.Success),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

/** Bouton de confirmation : c'est le site qui débite et livre. */
export const handleShopComponent: ComponentHandler = async (
  interaction,
  action,
  args,
) => {
  if (action !== "buy" || !interaction.isButton()) return;
  const productId = args[0];
  if (!productId) return;

  // La réponse est mise à jour tout de suite : le bouton ne doit pas rester
  // cliquable pendant que le paiement part.
  await interaction.update({
    embeds: [brandEmbed().setDescription("⏳ Paiement en cours…")],
    components: [],
  });

  const result = await purchase(interaction.user.id, productId);
  if (!result.ok) {
    await interaction.editReply({ embeds: [errorEmbed(result.error)] });
    return;
  }

  logger.info(
    { userId: interaction.user.id, productId, credits: result.data.credits },
    "Achat boutique depuis Discord",
  );

  await interaction.editReply({
    embeds: [
      successEmbed(
        `**${result.data.productName}** acheté pour **${result.data.credits}** pièces. Il te reste **${result.data.remaining}** pièces — connecte-toi en jeu pour en profiter. 🍀`,
      ),
    ],
  });
};
