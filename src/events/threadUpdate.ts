import { logger } from "../lib/logger";
import { logThreadUpdate } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const threadUpdate: EventHandler<"threadUpdate"> = {
  name: "threadUpdate",
  async execute(_client, oldThread, newThread) {
    await logThreadUpdate(oldThread, newThread).catch((err) =>
      logger.error({ err, threadId: newThread.id }, "Log de modification de fil impossible"),
    );
  },
};

export default threadUpdate;
