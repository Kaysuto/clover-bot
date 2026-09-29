import { logger } from "../lib/logger";
import { logEmojiChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const emojiDelete: EventHandler<"emojiDelete"> = {
  name: "emojiDelete",
  async execute(_client, emoji) {
    await logEmojiChange("delete", emoji).catch((err) =>
      logger.error({ err }, "Log d'émoji impossible"),
    );
  },
};

export default emojiDelete;
