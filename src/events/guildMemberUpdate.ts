import { logger } from "../lib/logger";
import { handleBoost } from "../modules/boost/manager";
import { logMemberUpdate } from "../modules/logs/members";
import type { EventHandler } from "../types";

const guildMemberUpdate: EventHandler<"guildMemberUpdate"> = {
  name: "guildMemberUpdate",
  async execute(_client, oldMember, newMember) {
    await logMemberUpdate(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Log de modification de membre impossible"),
    );
    await handleBoost(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Récompense de boost impossible"),
    );
  },
};

export default guildMemberUpdate;
