import { logger } from "../lib/logger";
import { inspectJoin } from "../modules/antiraid/manager";
import { trackJoin } from "../modules/invites/tracker";
import { logMemberJoin } from "../modules/logs/members";
import { syncMember } from "../modules/sync/manager";
import { sendWelcomeDm } from "../modules/welcome/join";
import type { EventHandler } from "../types";

const guildMemberAdd: EventHandler<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(_client, member) {
    // 1. Contrôle d'entrée, avant tout le reste : un compte écarté ne doit pas
    //    d'abord recevoir ses rôles et son MP de bienvenue.
    const rejected = await inspectJoin(member).catch((err: unknown) => {
      logger.error({ err, memberId: member.id }, "Contrôle anti-raid impossible");
      return false;
    });
    // 2. Attribution de l'invitation (même écarté : le parrain doit être connu,
    //    et le suivi d'invitation décidera lui-même de ne rien récompenser)
    await trackJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi d'invitation impossible"),
    );
    // 3. Log d'arrivée (après le suivi : il cite l'invitation utilisée)
    await logMemberJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Log d'arrivée impossible"),
    );
    if (rejected) return;
    // 4. Synchro immédiate si le compte est déjà lié
    if (!member.user.bot) {
      await syncMember(member).catch((err) =>
        logger.error({ err, memberId: member.id }, "Synchro à l'arrivée impossible"),
      );
    }
    // 5. MP de bienvenue (après la synchro : le membre a déjà ses rôles)
    await sendWelcomeDm(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "MP de bienvenue impossible"),
    );
  },
};

export default guildMemberAdd;
