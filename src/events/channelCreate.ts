import { logger } from "../lib/logger";
import { logChannelCreate } from "../modules/logs/server";
import type { EventHandler } from "../types";

const channelCreate: EventHandler<"channelCreate"> = {
  name: "channelCreate",
  async execute(_client, channel) {
    await logChannelCreate(channel).catch((err) =>
      logger.error({ err, channelId: channel.id }, "Log de création de salon impossible"),
    );
  },
};

export default channelCreate;
