import { logger } from "../lib/logger";
import { logEmojiChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const emojiUpdate: EventHandler<"emojiUpdate"> = {
  name: "emojiUpdate",
  async execute(_client, oldEmoji, newEmoji) {
    await logEmojiChange("update", newEmoji, oldEmoji).catch((err) =>
      logger.error({ err }, "Log d'émoji impossible"),
    );
  },
};

export default emojiUpdate;
