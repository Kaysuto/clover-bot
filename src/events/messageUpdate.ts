import { logger } from "../lib/logger";
import { logMessageUpdate } from "../modules/logs/extra";
import { inspectEditedMessage } from "../modules/security/messages";
import type { EventHandler } from "../types";

const messageUpdate: EventHandler<"messageUpdate"> = {
  name: "messageUpdate",
  async execute(_client, oldMessage, newMessage) {
    await logMessageUpdate(oldMessage, newMessage).catch((err) =>
      logger.error({ err }, "Log de modification de message impossible"),
    );
    if (newMessage.partial || oldMessage.content === newMessage.content) return;
    await inspectEditedMessage(newMessage).catch((err) =>
      logger.error({ err }, "Contrôle de sécurité du message modifié impossible"),
    );
  },
};

export default messageUpdate;
