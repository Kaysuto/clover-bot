import { logger } from "../lib/logger";
import { trackLeave } from "../modules/invites/tracker";
import type { EventHandler } from "../types";

const guildMemberRemove: EventHandler<"guildMemberRemove"> = {
  name: "guildMemberRemove",
  async execute(_client, member) {
    await trackLeave(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi de départ impossible"),
    );
  },
};

export default guildMemberRemove;
