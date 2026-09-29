import { logger } from "../lib/logger";
import { logChannelCreate } from "../modules/logs/server";
import { onChannelCreate } from "../modules/security/antinuke";
import type { EventHandler } from "../types";

const channelCreate: EventHandler<"channelCreate"> = {
  name: "channelCreate",
  async execute(_client, channel) {
    await Promise.all([
      onChannelCreate(channel).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Contrôle anti-nuke impossible"),
      ),
      logChannelCreate(channel).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Log de création de salon impossible"),
      ),
    ]);
  },
};

export default channelCreate;
