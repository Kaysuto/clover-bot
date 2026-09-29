import { logger } from "../lib/logger";
import { logMessageDelete } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const messageDelete: EventHandler<"messageDelete"> = {
  name: "messageDelete",
  async execute(_client, message) {
    await logMessageDelete(message).catch((err) =>
      logger.error({ err }, "Log de suppression de message impossible"),
    );
  },
};

export default messageDelete;
