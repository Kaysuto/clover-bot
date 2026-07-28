import { logger } from "../lib/logger";
import { logBanRemove } from "../modules/logs/moderation";
import type { EventHandler } from "../types";

const guildBanRemove: EventHandler<"guildBanRemove"> = {
  name: "guildBanRemove",
  async execute(_client, ban) {
    await logBanRemove(ban).catch((err) =>
      logger.error({ err, userId: ban.user.id }, "Log de débannissement impossible"),
    );
  },
};

export default guildBanRemove;
