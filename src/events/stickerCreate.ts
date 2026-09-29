import { logger } from "../lib/logger";
import { logStickerChange } from "../modules/logs/extra";
import type { EventHandler } from "../types";

const stickerCreate: EventHandler<"stickerCreate"> = {
  name: "stickerCreate",
  async execute(_client, sticker) {
    await logStickerChange("create", sticker).catch((err) =>
      logger.error({ err }, "Log de sticker impossible"),
    );
  },
};

export default stickerCreate;
