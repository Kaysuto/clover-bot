import { logger } from "../lib/logger";
import { logWebhooksUpdate } from "../modules/logs/extra";
import { onWebhooksUpdate } from "../modules/security/antiwebhook";
import type { EventHandler } from "../types";

const webhooksUpdate: EventHandler<"webhooksUpdate"> = {
  name: "webhooksUpdate",
  async execute(_client, channel) {
    await Promise.all([
      onWebhooksUpdate(channel).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Contrôle anti-webhook impossible"),
      ),
      logWebhooksUpdate(channel.guild, channel.id).catch((err) =>
        logger.error({ err, channelId: channel.id }, "Log de webhook impossible"),
      ),
    ]);
  },
};

export default webhooksUpdate;
