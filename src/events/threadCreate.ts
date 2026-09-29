import { logger } from "../lib/logger";
import { logThreadCreate } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const threadCreate: EventHandler<"threadCreate"> = {
  name: "threadCreate",
  async execute(_client, thread, newlyCreated) {
    await logThreadCreate(thread, newlyCreated).catch((err) =>
      logger.error({ err, threadId: thread.id }, "Log de création de fil impossible"),
    );
  },
};

export default threadCreate;
