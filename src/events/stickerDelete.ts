import { logger } from "../lib/logger";
import { logStickerChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const stickerDelete: EventHandler<"stickerDelete"> = {
  name: "stickerDelete",
  async execute(_client, sticker) {
    await logStickerChange("delete", sticker).catch((err) =>
      logger.error({ err }, "Log de sticker impossible"),
    );
  },
};

export default stickerDelete;
