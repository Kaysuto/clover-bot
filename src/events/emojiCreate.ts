import { logger } from "../lib/logger";
import { logEmojiChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const emojiCreate: EventHandler<"emojiCreate"> = {
  name: "emojiCreate",
  async execute(_client, emoji) {
    await logEmojiChange("create", emoji).catch((err) =>
      logger.error({ err }, "Log d'émoji impossible"),
    );
  },
};

export default emojiCreate;
