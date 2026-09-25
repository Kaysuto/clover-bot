import { recordGuildRemoval } from "../db/guild-installations";
import { logger } from "../lib/logger";
import type { EventHandler } from "../types";

const guildDelete: EventHandler<"guildDelete"> = {
  name: "guildDelete",
  async execute(_client, guild) {
    await recordGuildRemoval(guild.id);
    logger.info({ guildId: guild.id, guildName: guild.name }, "Bot retiré d’une guilde");
  },
};

export default guildDelete;
