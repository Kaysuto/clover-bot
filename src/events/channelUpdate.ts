import { logger } from "../lib/logger";
import { logChannelUpdate } from "../modules/logs/server";
import type { EventHandler } from "../types";

const channelUpdate: EventHandler<"channelUpdate"> = {
  name: "channelUpdate",
  async execute(_client, oldChannel, newChannel) {
    if (oldChannel.isDMBased() || newChannel.isDMBased()) return;
    await logChannelUpdate(oldChannel, newChannel).catch((err) =>
      logger.error(
        { err, channelId: newChannel.id },
        "Log de modification de salon impossible",
      ),
    );
  },
};

export default channelUpdate;
