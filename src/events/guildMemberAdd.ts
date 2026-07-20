import { logger } from "../lib/logger";
import { trackJoin } from "../modules/invites/tracker";
import { syncMember } from "../modules/sync/manager";
import type { EventHandler } from "../types";

const guildMemberAdd: EventHandler<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(_client, member) {
    // 1. Attribution de l'invitation
    await trackJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi d'invitation impossible"),
    );
    // 2. Synchro immédiate si le compte est déjà lié
    if (!member.user.bot) {
      await syncMember(member).catch((err) =>
        logger.error({ err, memberId: member.id }, "Synchro à l'arrivée impossible"),
      );
    }
  },
};

export default guildMemberAdd;
