import { logger } from "../lib/logger";
import { logChannelDelete } from "../modules/logs/server";
import { onChannelDelete } from "../modules/security/antinuke";
import type { EventHandler } from "../types";

const channelDelete: EventHandler<"channelDelete"> = {
  name: "channelDelete",
  async execute(_client, channel) {
    if (channel.isDMBased()) return;
    // L'anti-nuke photographie le salon dès son appel, avant tout `await`.
    await Promise.all([
      onChannelDelete(channel).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Contrôle anti-nuke impossible"),
      ),
      logChannelDelete(channel).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Log de suppression de salon impossible"),
      ),
    ]);
  },
};

export default channelDelete;
