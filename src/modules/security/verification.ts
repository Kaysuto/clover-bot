import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type Role,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig, updateGuildConfig } from "../../db/guild-config";
import { botVerifications } from "../../db/schema";
import { brandEmbed, errorEmbed, successEmbed } from "../../lib/embeds";
import { buildId } from "../../lib/ids";
import { logger } from "../../lib/logger";
import { moduleEnabled } from "../dashboard/modules";
import { createBackup } from "./backups";
import { captchaMatches, randomCode, renderCaptcha } from "./captcha";

/**
 * Vérification des arrivants : @everyone perd la vue des salons, le rôle
 * « Vérifié » la donne, et seul le salon de vérification reste visible.
 *
 * L'activation se fait en deux temps (`verifyState`) pour ne couper l'accès à
 * personne : `preparing` donne d'abord le rôle, par lots, à tous les membres
 * déjà présents (job `security-verification`), puis `active` retire la vue à
 * @everyone. L'état vit en base : un redémarrage reprend où il en était.
 */

const MAX_ATTEMPTS = 3;
/** Rôles donnés par tick pendant la préparation (limites de débit Discord). */
const GRANT_BATCH = 40;
const REASON = "Vérification des arrivants";

export async function activateVerification(
  guild: Guild,
  role: Role,
  channel: GuildTextBasedChannel,
  mode: "bouton" | "captcha",
  kickMinutes: number,
  by: string,
): Promise<string | null> {
  const me = await guild.members.fetchMe();
  if (role.managed || role.id === guild.id) return "Choisis un rôle ordinaire.";
  if (role.position >= me.roles.highest.position) return "Ce rôle est au-dessus du mien.";
  if (!("permissionOverwrites" in channel) || channel.isThread()) return "Choisis un salon textuel.";

  // L'activation touche aux permissions de tout le serveur : sauvegarde d'abord.
  await createBackup(guild, "manuel", by, "Avant activation de la vérification");

  await channel.permissionOverwrites.edit(
    guild.id,
    { ViewChannel: true, ReadMessageHistory: true, SendMessages: false },
    { reason: REASON },
  );
  await channel.permissionOverwrites.edit(role.id, { ViewChannel: false }, { reason: REASON });

  const panel = await channel.send({
    embeds: [
      brandEmbed()
        .setTitle("🔐 Vérification")
        .setDescription(
          mode === "captcha"
            ? "Bienvenue ! Clique sur le bouton, puis recopie le code de l'image pour accéder au serveur."
            : "Bienvenue ! Clique sur le bouton pour accéder au serveur.",
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId("secu", "verify"))
          .setLabel("Me vérifier")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  });

  await updateGuildConfig(guild.id, {
    verifyRoleId: role.id,
    verifyChannelId: channel.id,
    verifyMessageId: panel.id,
    verifyMode: mode,
    verifyKickMinutes: kickMinutes,
    verifyState: "preparing",
    verifyActivatedAt: new Date(),
  });
  return null;
}

/** Rend la vue à @everyone ; le rôle et le salon restent en place. */
export async function deactivateVerification(guild: Guild): Promise<void> {
  const everyone = guild.roles.everyone;
  if (!everyone.permissions.has(PermissionFlagsBits.ViewChannel))
    await everyone.setPermissions(everyone.permissions.add(PermissionFlagsBits.ViewChannel), REASON);
  await updateGuildConfig(guild.id, { verifyState: "off" });
  await db.delete(botVerifications).where(eq(botVerifications.guildId, guild.id));
}

/** Arrivée d'un membre pendant que la vérification est active : échéance d'expulsion. */
export async function onVerificationJoin(member: GuildMember): Promise<void> {
  const cfg = await getGuildConfig(member.guild.id);
  if (cfg.verifyState === "off") return;
  // Un bot ne passe pas de captcha ; ses permissions relèvent de la quarantaine des bots.
  if (member.user.bot) {
    if (cfg.verifyRoleId) await member.roles.add(cfg.verifyRoleId, REASON).catch(() => undefined);
    return;
  }
  if (cfg.verifyKickMinutes <= 0) return;
  if (!(await moduleEnabled(member.guild.id, "verification"))) return;
  await db
    .insert(botVerifications)
    .values({
      guildId: member.guild.id,
      userId: member.id,
      kickAt: new Date(Date.now() + cfg.verifyKickMinutes * 60_000),
    })
    .onConflictDoUpdate({
      target: [botVerifications.guildId, botVerifications.userId],
      set: { kickAt: new Date(Date.now() + cfg.verifyKickMinutes * 60_000), code: null, attempts: 0 },
    });
}

async function grantVerified(member: GuildMember): Promise<boolean> {
  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.verifyRoleId) return false;
  const ok = await member.roles
    .add(cfg.verifyRoleId, REASON)
    .then(() => true)
    .catch(() => false);
  if (ok) {
    await db
      .delete(botVerifications)
      .where(and(eq(botVerifications.guildId, member.guild.id), eq(botVerifications.userId, member.id)));
  }
  return ok;
}

async function ephemeral(interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">, ok: boolean, text: string) {
  await interaction.reply({
    embeds: [ok ? successEmbed(text) : errorEmbed(text)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Bouton « Me vérifier » du panneau. */
export async function handleVerifyButton(interaction: ButtonInteraction<"cached">): Promise<void> {
  const member = interaction.member;
  const cfg = await getGuildConfig(interaction.guildId);
  if (cfg.verifyState === "off" || !cfg.verifyRoleId) {
    await ephemeral(interaction, false, "La vérification n'est pas active.");
    return;
  }
  if (member.roles.cache.has(cfg.verifyRoleId)) {
    await ephemeral(interaction, true, "Tu es déjà vérifié.");
    return;
  }
  if (cfg.raidQuarantineRoleId && member.roles.cache.has(cfg.raidQuarantineRoleId)) {
    await ephemeral(interaction, false, "Ton compte est en quarantaine : un membre du staff doit te valider.");
    return;
  }

  if (cfg.verifyMode !== "captcha") {
    const ok = await grantVerified(member);
    await ephemeral(interaction, ok, ok ? "Vérifié, bienvenue !" : "Le rôle n'a pas pu t'être donné, préviens le staff.");
    return;
  }

  const code = randomCode();
  await db
    .insert(botVerifications)
    .values({ guildId: interaction.guildId, userId: member.id, code })
    .onConflictDoUpdate({
      target: [botVerifications.guildId, botVerifications.userId],
      set: { code, attempts: 0 },
    });
  await interaction.reply({
    embeds: [brandEmbed().setDescription("Recopie le code de l'image, puis clique sur **Saisir le code**.").setImage("attachment://captcha.png")],
    files: [new AttachmentBuilder(await renderCaptcha(code), { name: "captcha.png" })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId("secu", "captcha"))
          .setLabel("Saisir le code")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function showCaptchaModal(interaction: ButtonInteraction<"cached">): Promise<void> {
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(buildId("secu", "captcha-modal"))
      .setTitle("Vérification")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("code")
            .setLabel("Code de l'image")
            .setStyle(TextInputStyle.Short)
            .setMinLength(4)
            .setMaxLength(8)
            .setRequired(true),
        ),
      ),
  );
}

export async function handleCaptchaModal(interaction: ModalSubmitInteraction<"cached">): Promise<void> {
  const [row] = await db
    .select()
    .from(botVerifications)
    .where(and(eq(botVerifications.guildId, interaction.guildId), eq(botVerifications.userId, interaction.user.id)));
  if (!row?.code) {
    await ephemeral(interaction, false, "Aucun code en cours : clique à nouveau sur **Me vérifier**.");
    return;
  }
  if (captchaMatches(row.code, interaction.fields.getTextInputValue("code"))) {
    const ok = await grantVerified(interaction.member);
    await ephemeral(interaction, ok, ok ? "Vérifié, bienvenue !" : "Le rôle n'a pas pu t'être donné, préviens le staff.");
    return;
  }
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await db
    .update(botVerifications)
    .set({ attempts, code: exhausted ? null : row.code })
    .where(and(eq(botVerifications.guildId, interaction.guildId), eq(botVerifications.userId, interaction.user.id)));
  await ephemeral(
    interaction,
    false,
    exhausted
      ? "Trop d'essais : clique à nouveau sur **Me vérifier** pour un nouveau code."
      : `Code incorrect, il te reste ${MAX_ATTEMPTS - attempts} essai(s).`,
  );
}

/**
 * Job (30 s) : avance les préparations (rôle donné par lots aux membres
 * présents avant l'activation, puis vue retirée à @everyone) et expulse les
 * arrivants non vérifiés dont l'échéance est passée.
 */
export async function tickVerification(client: CloverClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    if (cfg.verifyState !== "preparing" || !cfg.verifyRoleId) continue;
    const role = guild.roles.cache.get(cfg.verifyRoleId);
    if (!role) continue;
    await guild.members.fetch().catch(() => undefined);
    const since = cfg.verifyActivatedAt?.getTime() ?? Date.now();
    const missing = guild.members.cache.filter(
      (m) => !m.roles.cache.has(role.id) && (m.user.bot || (m.joinedTimestamp ?? 0) < since),
    );
    for (const member of [...missing.values()].slice(0, GRANT_BATCH)) {
      await member.roles.add(role.id, REASON).catch(() => undefined);
    }
    if (missing.size > GRANT_BATCH) continue;

    if (!role.permissions.has(PermissionFlagsBits.ViewChannel))
      await role.setPermissions(role.permissions.add(PermissionFlagsBits.ViewChannel), REASON).catch(() => undefined);
    const everyone = guild.roles.everyone;
    await everyone
      .setPermissions(everyone.permissions.remove(PermissionFlagsBits.ViewChannel), REASON)
      .catch((err: unknown) => logger.error({ err, guildId: guild.id }, "Vue de @everyone non retirée"));
    await updateGuildConfig(guild.id, { verifyState: "active" });
    logger.info({ guildId: guild.id }, "Vérification des arrivants active");
  }

  const due = await db
    .select()
    .from(botVerifications)
    .where(and(isNotNull(botVerifications.kickAt), lte(botVerifications.kickAt, new Date())))
    .limit(50);
  for (const row of due) {
    await db
      .delete(botVerifications)
      .where(and(eq(botVerifications.guildId, row.guildId), eq(botVerifications.userId, row.userId)));
    const guild = client.guilds.cache.get(row.guildId);
    const cfg = guild ? await getGuildConfig(guild.id) : null;
    if (!guild || !cfg?.verifyRoleId || cfg.verifyState === "off") continue;
    const member = await guild.members.fetch(row.userId).catch(() => null);
    if (!member || member.roles.cache.has(cfg.verifyRoleId)) continue;
    await member
      .send(`Tu n'as pas terminé la vérification de **${guild.name}** à temps. Tu peux revenir quand tu veux et recommencer.`)
      .catch(() => undefined);
    await member.kick("Vérification non terminée à temps").catch(() => undefined);
  }
}
