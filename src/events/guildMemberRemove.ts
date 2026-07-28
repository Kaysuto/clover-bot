import { logger } from "../lib/logger";
import { trackLeave } from "../modules/invites/tracker";
import { logMemberLeave } from "../modules/logs/members";
import type { EventHandler } from "../types";

const guildMemberRemove: EventHandler<"guildMemberRemove"> = {
  name: "guildMemberRemove",
  async execute(_client, member) {
    await trackLeave(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi de départ impossible"),
    );
    await logMemberLeave(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Log de départ impossible"),
    );
  },
};

export default guildMemberRemove;
