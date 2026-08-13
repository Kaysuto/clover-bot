import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { botServerCounters, botServers } from "../../db/schema";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { getServerStatus } from "../../lib/mc-status";
import {
  getServer,
  invalidateServers,
  rconPasswordFor,
  serverAddress,
} from "../../lib/servers";
import type { Command } from "../../types";

/** Clé technique : minuscules, sans espace — elle sert aussi dans le `.env`. */
function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents : « créatif » → « creatif »
    .replace(/[^a-z0-9]/g, "");
}

const reseau: Command = {
  data: new SlashCommandBuilder()
    .setName("reseau")
    .setDescription("Serveurs Minecraft du réseau (admin)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s.setName("liste").setDescription("Lister les serveurs enregistrés"),
    )
    .addSubcommand((s) =>
      s
        .setName("ajouter")
        .setDescription("Ajouter (ou remplacer) un serveur du réseau")
        .addStringOption((o) =>
          o.setName("cle").setDescription("Clé technique, ex. skypvp").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("nom").setDescription("Nom affiché, ex. SkyPvP").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("hote").setDescription("Adresse pingée (SLP)").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("port")
            .setDescription("Port Minecraft (25565 par défaut)")
            .setMinValue(1)
            .setMaxValue(65535),
        )
        .addStringOption((o) => o.setName("emoji").setDescription("Émoji affiché"))
        .addStringOption((o) =>
          o.setName("rcon-hote").setDescription("Adresse RCON"),
        )
        .addIntegerOption((o) =>
          o
            .setName("rcon-port")
            .setDescription("Port RCON")
            .setMinValue(1)
            .setMaxValue(65535),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("modifier")
        .setDescription("Modifier un serveur existant")
        .addStringOption((o) =>
          o
            .setName("serveur")
            .setDescription("Serveur concerné")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) => o.setName("nom").setDescription("Nom affiché"))
        .addStringOption((o) => o.setName("emoji").setDescription("Émoji affiché"))
        .addStringOption((o) => o.setName("hote").setDescription("Adresse pingée"))
        .addIntegerOption((o) =>
          o.setName("port").setDescription("Port Minecraft").setMinValue(1).setMaxValue(65535),
        )
        .addStringOption((o) => o.setName("rcon-hote").setDescription("Adresse RCON"))
        .addIntegerOption((o) =>
          o.setName("rcon-port").setDescription("Port RCON").setMinValue(1).setMaxValue(65535),
        )
        .addIntegerOption((o) =>
          o.setName("ordre").setDescription("Ordre d'affichage").setMinValue(0),
        )
        .addBooleanOption((o) =>
          o.setName("defaut").setDescription("Serveur pris par défaut (RCON, ping)"),
        )
        .addBooleanOption((o) =>
          o.setName("actif").setDescription("Afficher et surveiller ce serveur"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("supprimer")
        .setDescription("Retirer un serveur du registre")
        .addStringOption((o) =>
          o
            .setName("serveur")
            .setDescription("Serveur concerné")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("compteur")
        .setDescription("Créer un salon vocal compteur dédié à un serveur")
        .addStringOption((o) =>
          o
            .setName("serveur")
            .setDescription("Serveur concerné")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName("modele")
            .setDescription("Modèle du nom : {emoji} {label} {count} {max}"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("compteur-retrait")
        .setDescription("Supprimer le compteur dédié à un serveur")
        .addStringOption((o) =>
          o
            .setName("serveur")
            .setDescription("Serveur concerné")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    const guildId = interaction.guildId;

    if (sub === "liste") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const servers = await db
        .select()
        .from(botServers)
        .orderBy(botServers.sortOrder, botServers.key);

      if (!servers.length) {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              "Aucun serveur enregistré. Ils sont créés au démarrage du bot, ou avec `/reseau ajouter`.",
            ),
          ],
        });
        return;
      }

      const counters = await db
        .select()
        .from(botServerCounters)
        .where(eq(botServerCounters.guildId, guildId));

      const lines = servers.map((server) => {
        const bits = [`\`${server.key}\``, serverAddress(server)];
        if (server.rconHost && server.rconPort) {
          bits.push(
            rconPasswordFor(server)
              ? `RCON ${server.rconPort} ✅`
              : `RCON ${server.rconPort} ⚠️ mot de passe absent`,
          );
        } else {
          bits.push("RCON non configuré");
        }
        const counter = counters.find((c) => c.serverKey === server.key);
        if (counter) bits.push(`compteur <#${counter.channelId}>`);
        return `${server.enabled ? "🟢" : "⚫"} ${server.emoji} **${server.label}**${
          server.isDefault ? " · défaut" : ""
        }\n└ ${bits.join(" · ")}`;
      });

      await interaction.editReply({
        embeds: [
          brandEmbed()
            .setTitle("🌐 Serveurs du réseau")
            .setDescription(lines.join("\n"))
            .setFooter({
              text: "Mot de passe RCON : variable RCON_PASSWORD_<CLE> du .env",
            }),
        ],
      });
      return;
    }

    if (sub === "ajouter") {
      const key = normalizeKey(interaction.options.getString("cle", true));
      if (!key) {
        await interaction.reply({
          embeds: [errorEmbed("Clé invalide : lettres et chiffres uniquement.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const values = {
        key,
        label: interaction.options.getString("nom", true),
        emoji: interaction.options.getString("emoji") ?? "🎮",
        host: interaction.options.getString("hote", true),
        port: interaction.options.getInteger("port") ?? 25565,
        rconHost: interaction.options.getString("rcon-hote"),
        rconPort: interaction.options.getInteger("rcon-port"),
      };
      await db
        .insert(botServers)
        .values(values)
        .onConflictDoUpdate({ target: botServers.key, set: values });
      invalidateServers();
      await interaction.reply({
        embeds: [
          successEmbed(
            `Serveur **${values.label}** enregistré sous la clé \`${key}\`. Mot de passe RCON attendu dans \`RCON_PASSWORD_${key.toUpperCase()}\`.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString("serveur", true);

    if (sub === "modifier") {
      const [existing] = await db
        .select()
        .from(botServers)
        .where(eq(botServers.key, key));
      if (!existing) {
        await interaction.reply({
          embeds: [errorEmbed(`Aucun serveur ne porte la clé \`${key}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const isDefault = interaction.options.getBoolean("defaut");
      const values = {
        label: interaction.options.getString("nom") ?? undefined,
        emoji: interaction.options.getString("emoji") ?? undefined,
        host: interaction.options.getString("hote") ?? undefined,
        port: interaction.options.getInteger("port") ?? undefined,
        rconHost: interaction.options.getString("rcon-hote") ?? undefined,
        rconPort: interaction.options.getInteger("rcon-port") ?? undefined,
        sortOrder: interaction.options.getInteger("ordre") ?? undefined,
        enabled: interaction.options.getBoolean("actif") ?? undefined,
        isDefault: isDefault ?? undefined,
      };

      // Le drapeau « défaut » est exclusif : le poser ailleurs le retire partout.
      if (isDefault) {
        await db.update(botServers).set({ isDefault: false });
      }
      await db.update(botServers).set(values).where(eq(botServers.key, key));
      invalidateServers();
      await interaction.reply({
        embeds: [successEmbed(`Serveur \`${key}\` mis à jour.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "supprimer") {
      await db.delete(botServers).where(eq(botServers.key, key));
      await db
        .delete(botServerCounters)
        .where(eq(botServerCounters.serverKey, key));
      invalidateServers();
      await interaction.reply({
        embeds: [
          successEmbed(
            `Serveur \`${key}\` retiré du registre (il sera recréé au prochain démarrage s'il fait partie du réseau d'origine).`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "compteur-retrait") {
      await db
        .delete(botServerCounters)
        .where(
          and(
            eq(botServerCounters.guildId, guildId),
            eq(botServerCounters.serverKey, key),
          ),
        );
      await interaction.reply({
        embeds: [
          successEmbed(
            "Compteur retiré. Le salon vocal, lui, doit être supprimé à la main.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // compteur
    const server = await getServer(key);
    if (!server) {
      await interaction.reply({
        embeds: [errorEmbed(`Aucun serveur actif ne porte la clé \`${key}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const template =
      interaction.options.getString("modele") ?? "{emoji} {label} : {count}";
    const status = await getServerStatus(server);
    const name = template
      .replaceAll("{count}", String(status.players))
      .replaceAll("{max}", String(status.maxPlayers))
      .replaceAll("{label}", server.label)
      .replaceAll("{emoji}", server.emoji);

    const channel = await interaction.guild.channels.create({
      name: name.slice(0, 100),
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.Connect],
        },
      ],
    });

    await db
      .insert(botServerCounters)
      .values({ guildId, serverKey: key, channelId: channel.id, template })
      .onConflictDoUpdate({
        target: [botServerCounters.guildId, botServerCounters.serverKey],
        set: { channelId: channel.id, template },
      });

    await interaction.editReply({
      embeds: [
        successEmbed(
          `Compteur de **${server.label}** créé : ${channel}. Il se met à jour toutes les 6 minutes.`,
        ),
      ],
    });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    // Ici on propose aussi les serveurs désactivés : ils doivent rester
    // modifiables et supprimables.
    const servers = await db
      .select()
      .from(botServers)
      .orderBy(botServers.sortOrder, botServers.key)
      .catch(() => []);
    await interaction.respond(
      servers
        .filter(
          (s) => s.key.includes(focused) || s.label.toLowerCase().includes(focused),
        )
        .slice(0, 25)
        .map((s) => ({ name: `${s.emoji} ${s.label} (${s.key})`, value: s.key })),
    );
  },
};

export default reseau;
