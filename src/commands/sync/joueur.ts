import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  botLevels,
  botMinecraftLinks,
  botSanctions,
  botVotes,
} from "../../db/schema";
import { usersMeta } from "../../db/site-schema";
import { brandEmbed, errorEmbed } from "../../lib/embeds";
import { dashedUuid, getPlayerGroups } from "../../lib/lp-db";
import { getLinkedAccount } from "../../modules/sync/manager";
import type { Command } from "../../types";

interface Resolved {
  discordId: string | null;
  minecraftUsername: string;
  minecraftUuid: string | null;
  source: "site" | "code";
}

/** Recherche par pseudo Minecraft, dans les deux tables de liaison. */
async function resolveByUsername(username: string): Promise<Resolved | null> {
  const needle = username.toLowerCase();

  const [site] = await db
    .select()
    .from(usersMeta)
    .where(sql`lower(${usersMeta.minecraftUsername}) = ${needle}`)
    .limit(1);
  if (site?.minecraftUsername) {
    return {
      discordId: site.discordId,
      minecraftUsername: site.minecraftUsername,
      minecraftUuid: site.minecraftUuid,
      source: "site",
    };
  }

  const [code] = await db
    .select()
    .from(botMinecraftLinks)
    .where(sql`lower(${botMinecraftLinks.minecraftUsername}) = ${needle}`)
    .limit(1);
  if (code) {
    return {
      discordId: code.discordId,
      minecraftUsername: code.minecraftUsername,
      minecraftUuid: code.minecraftUuid,
      source: "code",
    };
  }
  return null;
}

const joueur: Command = {
  data: new SlashCommandBuilder()
    .setName("joueur")
    .setDescription("Fiche d'un joueur : liaison, niveau, grades, votes")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre Discord"),
    )
    .addStringOption((o) =>
      o.setName("pseudo").setDescription("Pseudo Minecraft"),
    ),

  async execute(interaction) {
    const member = interaction.options.getUser("membre");
    const pseudo = interaction.options.getString("pseudo");

    if (!member && !pseudo) {
      await interaction.reply({
        embeds: [errorEmbed("Précise un membre Discord **ou** un pseudo Minecraft.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let resolved: Resolved | null = null;
    if (member) {
      const linked = await getLinkedAccount(member.id);
      if (linked) {
        resolved = {
          discordId: member.id,
          minecraftUsername: linked.minecraftUsername,
          minecraftUuid: linked.minecraftUuid,
          source: linked.source,
        };
      }
    } else if (pseudo) {
      resolved = await resolveByUsername(pseudo);
    }

    if (!resolved) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            member
              ? `${member} n'a aucun compte Minecraft lié.`
              : `Aucun compte Discord lié au pseudo \`${pseudo}\`.`,
          ),
        ],
      });
      return;
    }

    const embed = brandEmbed()
      .setTitle(`🔗 ${resolved.minecraftUsername}`)
      .setThumbnail(
        `https://mc-heads.net/avatar/${resolved.minecraftUuid ?? resolved.minecraftUsername}/128`,
      )
      .addFields(
        {
          name: "Discord",
          value: resolved.discordId ? `<@${resolved.discordId}>` : "—",
          inline: true,
        },
        {
          name: "Liaison",
          value: resolved.source === "site" ? "🌐 Site web" : "🎮 Code en jeu",
          inline: true,
        },
        {
          name: "UUID",
          value: resolved.minecraftUuid ? `\`${resolved.minecraftUuid}\`` : "—",
          inline: false,
        },
      );

    if (resolved.discordId) {
      const [level] = await db
        .select()
        .from(botLevels)
        .where(
          and(
            eq(botLevels.guildId, interaction.guildId),
            eq(botLevels.userId, resolved.discordId),
          ),
        )
        .limit(1);
      embed.addFields({
        name: "Niveau",
        value: level ? `**${level.level}** · ${level.xp} XP` : "0",
        inline: true,
      });

      const sanctions = await db
        .select()
        .from(botSanctions)
        .where(
          and(
            eq(botSanctions.guildId, interaction.guildId),
            eq(botSanctions.userId, resolved.discordId),
          ),
        );
      embed.addFields({
        name: "Sanctions",
        value: sanctions.length
          ? `${sanctions.length} (dont ${sanctions.filter((s) => s.active).length} active(s))`
          : "Aucune",
        inline: true,
      });
    }

    const [lastVote] = await db
      .select()
      .from(botVotes)
      .where(
        sql`lower(${botVotes.minecraftUsername}) = ${resolved.minecraftUsername.toLowerCase()}`,
      )
      .orderBy(desc(botVotes.votedAt))
      .limit(1);
    embed.addFields({
      name: "Dernier vote",
      value: lastVote
        ? `<t:${Math.floor(lastVote.votedAt.getTime() / 1_000)}:R> (${lastVote.site})`
        : "Aucun",
      inline: true,
    });

    if (resolved.minecraftUuid) {
      const lp = await getPlayerGroups(dashedUuid(resolved.minecraftUuid));
      if (lp) {
        embed.addFields({
          name: "Grades en jeu",
          value: lp.groups.map((g) => `\`${g}\``).join(" · "),
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default joueur;
