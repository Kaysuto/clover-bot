import { logger } from "../lib/logger";
import { logStickerChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const stickerUpdate: EventHandler<"stickerUpdate"> = {
  name: "stickerUpdate",
  async execute(_client, oldSticker, newSticker) {
    await logStickerChange("update", newSticker, oldSticker).catch((err) =>
      logger.error({ err }, "Log de sticker impossible"),
    );
  },
};

export default stickerUpdate;
