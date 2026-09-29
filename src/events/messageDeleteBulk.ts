import { logger } from "../lib/logger";
import { logMessageBulkDelete } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const messageDeleteBulk: EventHandler<"messageDeleteBulk"> = {
  name: "messageDeleteBulk",
  async execute(_client, messages, channel) {
    await logMessageBulkDelete(messages, channel).catch((err) =>
      logger.error({ err }, "Log de suppression groupée impossible"),
    );
  },
};

export default messageDeleteBulk;
