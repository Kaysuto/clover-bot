import { recordGuildInstallation } from "../db/guild-installations";
import { logger } from "../lib/logger";
import type { EventHandler } from "../types";

const guildCreate: EventHandler<"guildCreate"> = {
  name: "guildCreate",
  async execute(_client, guild) {
    await recordGuildInstallation(guild);
    logger.info({ guildId: guild.id, guildName: guild.name }, "Bot installé sur une guilde");
  },
};

export default guildCreate;
