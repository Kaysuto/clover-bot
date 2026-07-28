import { logger } from "../lib/logger";
import { logBanAdd } from "../modules/logs/moderation";
import type { EventHandler } from "../types";

const guildBanAdd: EventHandler<"guildBanAdd"> = {
  name: "guildBanAdd",
  async execute(_client, ban) {
    await logBanAdd(ban).catch((err) =>
      logger.error({ err, userId: ban.user.id }, "Log de bannissement impossible"),
    );
  },
};

export default guildBanAdd;
