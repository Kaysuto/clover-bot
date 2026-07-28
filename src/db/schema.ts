import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Configuration par guilde ────────────────────────────────────────────────

export const botGuildConfig = pgTable("bot_guild_config", {
  guildId: text("guild_id").primaryKey(),

  // Niveaux (les passages de niveau sont annoncés en message privé)
  levelupMessage: text("levelup_message")
    .notNull()
    .default("🎉 {user} passe au niveau **{level}** !"),
  xpMin: integer("xp_min").notNull().default(15),
  xpMax: integer("xp_max").notNull().default(25),
  xpCooldownSec: integer("xp_cooldown_sec").notNull().default(60),
  voiceXpPerMin: integer("voice_xp_per_min").notNull().default(5),
  noXpChannelIds: text("no_xp_channel_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),

  // Synchronisation Discord ↔ Minecraft
  linkedRoleId: text("linked_role_id"),
  syncNicknames: boolean("sync_nicknames").notNull().default(true),

  // Compteur de joueurs Minecraft
  counterChannelId: text("counter_channel_id"),
  counterTemplate: text("counter_template")
    .notNull()
    .default("🎮 En ligne : {count}"),

  // Compteur de membres Discord (hors bots)
  memberCounterChannelId: text("member_counter_channel_id"),
  memberCounterTemplate: text("member_counter_template")
    .notNull()
    .default("👥 Membres : {count}"),

  // Tickets
  ticketCategoryId: text("ticket_category_id"),
  ticketArchiveChannelId: text("ticket_archive_channel_id"),
  ticketSupportRoleId: text("ticket_support_role_id"),
  ticketPanelChannelId: text("ticket_panel_channel_id"),
  ticketPanelMessageId: text("ticket_panel_message_id"),
  ticketCounter: integer("ticket_counter").notNull().default(0),

  // Vocaux temporaires
  tempvoiceHubId: text("tempvoice_hub_id"),
  tempvoiceCategoryId: text("tempvoice_category_id"),

  // Statut des services
  statusChannelId: text("status_channel_id"),
  statusMessageId: text("status_message_id"),

  logChannelId: text("log_channel_id"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Niveaux ─────────────────────────────────────────────────────────────────

export const botLevels = pgTable(
  "bot_levels",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    level: integer("level").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    voiceMinutes: integer("voice_minutes").notNull().default(0),
    lastMessageXpAt: timestamp("last_message_xp_at"),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    index("bot_levels_guild_xp_idx").on(t.guildId, t.xp.desc()),
  ],
);

export const botLevelRoles = pgTable(
  "bot_level_roles",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    level: integer("level").notNull(),
    roleId: text("role_id").notNull(),
  },
  (t) => [uniqueIndex("bot_level_roles_guild_level_idx").on(t.guildId, t.level)],
);

// ─── Logs ────────────────────────────────────────────────────────────────────

/**
 * Réglage d'une catégorie de logs. Ligne absente = catégorie active, publiée
 * dans le salon par défaut (`bot_guild_config.log_channel_id`).
 */
export const botLogSettings = pgTable(
  "bot_log_settings",
  {
    guildId: text("guild_id").notNull(),
    category: text("category").notNull(), // membres | moderation | vocal | serveur
    channelId: text("channel_id"), // null = salon de logs par défaut
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.category] })],
);

// ─── Giveaways ───────────────────────────────────────────────────────────────

export const botGiveaways = pgTable(
  "bot_giveaways",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").unique(),
    prize: text("prize").notNull(),
    winnersCount: integer("winners_count").notNull().default(1),
    hostId: text("host_id").notNull(),
    requiredRoleId: text("required_role_id"),
    requiredMinLevel: integer("required_min_level"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    ended: boolean("ended").notNull().default(false),
    winnerIds: text("winner_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("bot_giveaways_due_idx").on(t.ended, t.endsAt)],
);

export const botGiveawayEntries = pgTable(
  "bot_giveaway_entries",
  {
    id: serial("id").primaryKey(),
    giveawayId: integer("giveaway_id")
      .notNull()
      .references(() => botGiveaways.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bot_giveaway_entries_unique_idx").on(t.giveawayId, t.userId),
  ],
);

// ─── Invitations ─────────────────────────────────────────────────────────────

/** Cache persistant de l'état des invitations Discord (code → uses). */
export const botInvites = pgTable(
  "bot_invites",
  {
    guildId: text("guild_id").notNull(),
    code: text("code").notNull(),
    inviterId: text("inviter_id"),
    uses: integer("uses").notNull().default(0),
    isVanity: boolean("is_vanity").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.code] })],
);

/** Journal « qui a rejoint via qui » — commence à l'installation du bot. */
export const botInviteJoins = pgTable(
  "bot_invite_joins",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    memberId: text("member_id").notNull(),
    inviterId: text("inviter_id"),
    code: text("code"),
    isVanity: boolean("is_vanity").notNull().default(false),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    leftAt: timestamp("left_at"),
  },
  (t) => [
    index("bot_invite_joins_inviter_idx").on(t.guildId, t.inviterId),
    index("bot_invite_joins_member_idx").on(t.guildId, t.memberId),
  ],
);

/**
 * Compteurs agrégés par inviteur. `seed_uses` = uses des invitations
 * existantes au moment de l'installation (l'API Discord ne permet pas de
 * savoir rétroactivement qui a invité qui — seuls les totaux sont repris).
 */
export const botInviteStats = pgTable(
  "bot_invite_stats",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    joins: integer("joins").notNull().default(0),
    leaves: integer("leaves").notNull().default(0),
    seedUses: integer("seed_uses").notNull().default(0),
    bonus: integer("bonus").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

// ─── Tickets ─────────────────────────────────────────────────────────────────

export const botTickets = pgTable(
  "bot_tickets",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    ticketNumber: integer("ticket_number").notNull(),
    channelId: text("channel_id").notNull().unique(),
    openerId: text("opener_id").notNull(),
    subject: text("subject").notNull(),
    category: text("category").notNull().default("support"),
    status: text("status").notNull().default("OPEN"), // OPEN | CLAIMED | CLOSED
    claimedBy: text("claimed_by"),
    closedBy: text("closed_by"),
    closeReason: text("close_reason"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => [index("bot_tickets_opener_idx").on(t.guildId, t.openerId, t.status)],
);

// ─── Vocaux temporaires ──────────────────────────────────────────────────────

export const botTempVoice = pgTable("bot_temp_voice", {
  voiceChannelId: text("voice_channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  textChannelId: text("text_channel_id").notNull(),
  ownerId: text("owner_id").notNull(),
  locked: boolean("locked").notNull().default(false),
  userLimit: integer("user_limit").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Liaison Minecraft par code in-game (phase 2) ────────────────────────────

/**
 * Liens créés via le code in-game (/link → /lier). Le lien effectué sur le
 * site vit dans users_meta (table du site, jamais écrite par le bot) et
 * prime en cas de conflit.
 */
export const botMinecraftLinks = pgTable("bot_minecraft_links", {
  discordId: text("discord_id").primaryKey(),
  minecraftUuid: text("minecraft_uuid").notNull().unique(),
  minecraftUsername: text("minecraft_username").notNull(),
  source: text("source").notNull().default("CODE"),
  linkedAt: timestamp("linked_at").notNull().defaultNow(),
});
