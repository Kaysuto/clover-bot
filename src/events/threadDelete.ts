import { logger } from "../lib/logger";
import { logThreadDelete } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const threadDelete: EventHandler<"threadDelete"> = {
  name: "threadDelete",
  async execute(_client, thread) {
    await logThreadDelete(thread).catch((err) =>
      logger.error({ err, threadId: thread.id }, "Log de suppression de fil impossible"),
    );
  },
};

export default threadDelete;
