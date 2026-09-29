import { logger } from "../lib/logger";
import { logGuildUpdate } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const guildUpdate: EventHandler<"guildUpdate"> = {
  name: "guildUpdate",
  async execute(_client, oldGuild, newGuild) {
    await logGuildUpdate(oldGuild, newGuild).catch((err) =>
      logger.error({ err, guildId: newGuild.id }, "Log de modification du serveur impossible"),
    );
  },
};

export default guildUpdate;
