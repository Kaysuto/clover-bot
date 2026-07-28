import { logger } from "../lib/logger";
import { logChannelDelete } from "../modules/logs/server";
import type { EventHandler } from "../types";

const channelDelete: EventHandler<"channelDelete"> = {
  name: "channelDelete",
  async execute(_client, channel) {
    if (channel.isDMBased()) return;
    await logChannelDelete(channel).catch((err) =>
      logger.error({ err, channelId: channel.id }, "Log de suppression de salon impossible"),
    );
  },
};

export default channelDelete;
