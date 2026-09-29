import { logger } from "../lib/logger";
import { logBanAdd } from "../modules/logs/moderation";
import { propagateBan } from "../modules/network/manager";
import { onBan } from "../modules/security/antinuke";
import type { EventHandler } from "../types";

const guildBanAdd: EventHandler<"guildBanAdd"> = {
  name: "guildBanAdd",
  async execute(_client, ban) {
    await Promise.all([
      onBan(ban).catch((err) =>
        logger.error({ err, userId: ban.user.id }, "Contrôle anti-nuke impossible"),
      ),
      logBanAdd(ban).catch((err) =>
        logger.error({ err, userId: ban.user.id }, "Log de bannissement impossible"),
      ),
      propagateBan(ban).catch((err) =>
        logger.error({ err, userId: ban.user.id }, "Propagation réseau du bannissement impossible"),
      ),
    ]);
  },
};

export default guildBanAdd;
