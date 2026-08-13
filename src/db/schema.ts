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

  // Accueil et départ (messages privés)
  welcomeDmEnabled: boolean("welcome_dm_enabled").notNull().default(true),
  /**
   * Modèle du MP de bienvenue. `null` = message par défaut du code
   * (`DEFAULT_WELCOME_MESSAGE`) : une amélioration de la formulation profite
   * ainsi à toutes les guildes qui n'ont rien personnalisé.
   */
  welcomeDmMessage: text("welcome_dm_message"),
  leaveSurveyEnabled: boolean("leave_survey_enabled").notNull().default(true),
  /** Salon des retours de départ ; à défaut, le salon de logs par défaut. */
  leaveFeedbackChannelId: text("leave_feedback_channel_id"),

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

  // Modération
  /** Rôle appliqué par `/sanction muter` quand le timeout Discord ne suffit pas. */
  muteRoleId: text("mute_role_id"),
  /** Répercuter bannissements et mutes sur le serveur Minecraft (compte lié). */
  sanctionPropagateMc: boolean("sanction_propagate_mc").notNull().default(false),
  /**
   * Commandes console de propagation. Les défauts sont les commandes vanilla,
   * valables sur n'importe quel serveur ; `{player}`, `{reason}` et
   * `{duration}` y sont remplacés. À adapter si un plugin de sanctions
   * (LiteBans, AdvancedBan…) est installé.
   */
  mcBanCommand: text("mc_ban_command").notNull().default("ban {player} {reason}"),
  mcUnbanCommand: text("mc_unban_command").notNull().default("pardon {player}"),
  mcKickCommand: text("mc_kick_command").notNull().default("kick {player} {reason}"),
  mcMuteCommand: text("mc_mute_command").notNull().default("mute {player} {duration}"),
  mcUnmuteCommand: text("mc_unmute_command").notNull().default("unmute {player}"),

  // Grades Minecraft → rôles Discord
  rankSyncEnabled: boolean("rank_sync_enabled").notNull().default(false),

  // Votes (listes de serveurs)
  voteChannelId: text("vote_channel_id"),
  voteRoleId: text("vote_role_id"),
  voteRoleHours: integer("vote_role_hours").notNull().default(24),
  /** Commande console lancée à chaque vote ; `{player}` est remplacé. */
  voteRconCommand: text("vote_rcon_command"),

  // Boosts Nitro
  boostChannelId: text("boost_channel_id"),
  boostMessage: text("boost_message"),
  /** Récompense in-game du boost ; `{player}` est remplacé. */
  boostRconCommand: text("boost_rcon_command"),

  // Suggestions
  suggestionChannelId: text("suggestion_channel_id"),

  // Candidatures staff
  applicationPanelChannelId: text("application_panel_channel_id"),
  applicationPanelMessageId: text("application_panel_message_id"),
  /** Salon où le staff reçoit et décide des candidatures. */
  applicationReviewChannelId: text("application_review_channel_id"),
  applicationsOpen: boolean("applications_open").notNull().default(false),

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
    /** Récompense in-game facultative ; `{player}` remplacé par le pseudo MC. */
    rconCommand: text("rcon_command"),
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

// ─── Retours de départ ───────────────────────────────────────────────────────

/**
 * Un membre part → une ligne, créée au moment de l'envoi du sondage privé.
 * La ligne existe même sans réponse : c'est ce qui permet de connaître le taux
 * de réponse (`status`) et de ne pas surestimer la représentativité des retours.
 */
export const botLeaveFeedback = pgTable(
  "bot_leave_feedback",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** Pseudo au moment du départ : le membre n'est plus consultable après coup. */
    username: text("username").notNull(),
    /** SENT | ANSWERED | DECLINED | UNREACHABLE (MP fermés) */
    status: text("status").notNull().default("SENT"),
    /** Clé de LEAVE_REASONS, null tant que le départ n'est pas expliqué. */
    reason: text("reason"),
    comment: text("comment"),
    /** Temps passé sur le serveur, en millisecondes. */
    membershipMs: bigint("membership_ms", { mode: "number" }),
    /** Message publié côté staff, réédité si un commentaire arrive ensuite. */
    staffMessageId: text("staff_message_id"),
    leftAt: timestamp("left_at").notNull().defaultNow(),
    answeredAt: timestamp("answered_at"),
  },
  (t) => [index("bot_leave_feedback_guild_idx").on(t.guildId, t.leftAt.desc())],
);

// ─── Vocaux temporaires ──────────────────────────────────────────────────────

export const botTempVoice = pgTable("bot_temp_voice", {
  voiceChannelId: text("voice_channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  textChannelId: text("text_channel_id").notNull(),
  /** Message de gestion à réactualiser quand l'état du vocal change. */
  panelMessageId: text("panel_message_id"),
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

// ─── Serveurs du réseau ─────────────────────────────────────────────────────

/**
 * Serveurs Minecraft du réseau. Table sans `guild_id` : elle décrit le réseau,
 * pas un serveur Discord. Le mot de passe RCON n'y figure volontairement PAS —
 * il vit dans le `.env` sous `RCON_PASSWORD_<CLE>` (cf. `lib/servers.ts`), la
 * base étant partagée avec le site.
 */
export const botServers = pgTable(
  "bot_servers",
  {
    key: text("key").primaryKey(), // lobby, practice, pvpsoup…
    label: text("label").notNull(),
    emoji: text("emoji").notNull().default("🎮"),
    /** Adresse pingée en SLP (peut être l'adresse publique du proxy). */
    host: text("host").notNull(),
    port: integer("port").notNull().default(25565),
    rconHost: text("rcon_host"),
    rconPort: integer("rcon_port"),
    /** Serveur pris par défaut quand aucune clé n'est précisée (le lobby). */
    isDefault: boolean("is_default").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("bot_servers_order_idx").on(t.enabled, t.sortOrder)],
);

/** Salon vocal compteur dédié à un serveur (le compteur global reste dans la config). */
export const botServerCounters = pgTable(
  "bot_server_counters",
  {
    guildId: text("guild_id").notNull(),
    serverKey: text("server_key").notNull(),
    channelId: text("channel_id").notNull(),
    template: text("template").notNull().default("{emoji} {label} : {count}"),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.serverKey] })],
);

// ─── Modération ─────────────────────────────────────────────────────────────

/** Types de sanction (valeur stockée dans `bot_sanctions.type`). */
export const SANCTION_TYPES = ["WARN", "MUTE", "KICK", "BAN"] as const;

/**
 * Historique des sanctions. Une ligne n'est jamais supprimée : la levée
 * bascule `active` à false et renseigne `revoked_*`, pour que `/casier`
 * garde la trace complète.
 */
export const botSanctions = pgTable(
  "bot_sanctions",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    type: text("type").notNull(), // WARN | MUTE | KICK | BAN
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** null = définitive (bannissement/avertissement sans échéance). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    revokedBy: text("revoked_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    /** Pseudo Minecraft sanctionné en même temps, si le compte était lié. */
    minecraftUsername: text("minecraft_username"),
  },
  (t) => [
    index("bot_sanctions_user_idx").on(t.guildId, t.userId, t.createdAt.desc()),
    index("bot_sanctions_due_idx").on(t.active, t.expiresAt),
  ],
);

// ─── Grades Minecraft ↔ rôles Discord ───────────────────────────────────────

/** Groupe LuckPerms → rôle Discord attribué aux comptes liés. */
export const botRankRoles = pgTable(
  "bot_rank_roles",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    lpGroup: text("lp_group").notNull(), // nom du groupe LuckPerms
    roleId: text("role_id").notNull(),
  },
  (t) => [uniqueIndex("bot_rank_roles_guild_group_idx").on(t.guildId, t.lpGroup)],
);

// ─── Votes ──────────────────────────────────────────────────────────────────

/**
 * Votes reçus des listes de serveurs (endpoint HTTP, cf. `modules/vote`).
 * `discord_id` est résolu depuis la liaison quand elle existe ; un vote d'un
 * joueur non lié est quand même historisé.
 */
export const botVotes = pgTable(
  "bot_votes",
  {
    id: serial("id").primaryKey(),
    site: text("site").notNull(),
    minecraftUsername: text("minecraft_username").notNull(),
    discordId: text("discord_id"),
    votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
    /** Fin du rôle temporaire « Votant » ; null si aucun rôle attribué. */
    roleExpiresAt: timestamp("role_expires_at", { withTimezone: true }),
    roleRemoved: boolean("role_removed").notNull().default(false),
  },
  (t) => [
    index("bot_votes_user_idx").on(t.minecraftUsername, t.votedAt.desc()),
    index("bot_votes_role_due_idx").on(t.roleRemoved, t.roleExpiresAt),
  ],
);

// ─── Suggestions ────────────────────────────────────────────────────────────

export const SUGGESTION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REFUSED",
  "DONE",
] as const;

export const botSuggestions = pgTable(
  "bot_suggestions",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").unique(),
    authorId: text("author_id").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("PENDING"),
    decidedBy: text("decided_by"),
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("bot_suggestions_guild_idx").on(t.guildId, t.createdAt.desc())],
);

/** Vote 👍/👎 : `value` vaut 1 ou -1, une seule ligne par membre. */
export const botSuggestionVotes = pgTable(
  "bot_suggestion_votes",
  {
    suggestionId: integer("suggestion_id")
      .notNull()
      .references(() => botSuggestions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    value: integer("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.suggestionId, t.userId] })],
);

// ─── Candidatures staff ─────────────────────────────────────────────────────

export const APPLICATION_STATUSES = ["PENDING", "ACCEPTED", "REFUSED"] as const;

export const botApplications = pgTable(
  "bot_applications",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** Poste visé (clé de `APPLICATION_POSITIONS`, cf. modules/applications). */
    position: text("position").notNull(),
    /** Réponses au formulaire, dans l'ordre des questions. */
    answers: text("answers").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("PENDING"),
    messageId: text("message_id"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bot_applications_guild_idx").on(t.guildId, t.status, t.createdAt.desc()),
  ],
);
