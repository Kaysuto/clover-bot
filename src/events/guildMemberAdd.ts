import { logger } from "../lib/logger";
import { trackJoin } from "../modules/invites/tracker";
import { logMemberJoin } from "../modules/logs/members";
import { syncMember } from "../modules/sync/manager";
import { sendWelcomeDm } from "../modules/welcome/join";
import type { EventHandler } from "../types";

const guildMemberAdd: EventHandler<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(_client, member) {
    // 1. Attribution de l'invitation
    await trackJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi d'invitation impossible"),
    );
    // 2. Log d'arrivée (après le suivi : il cite l'invitation utilisée)
    await logMemberJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Log d'arrivée impossible"),
    );
    // 3. Synchro immédiate si le compte est déjà lié
    if (!member.user.bot) {
      await syncMember(member).catch((err) =>
        logger.error({ err, memberId: member.id }, "Synchro à l'arrivée impossible"),
      );
    }
    // 4. MP de bienvenue (après la synchro : le membre a déjà ses rôles)
    await sendWelcomeDm(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "MP de bienvenue impossible"),
    );
  },
};

export default guildMemberAdd;
