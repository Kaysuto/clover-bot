import { logger } from "../lib/logger";
import { inspectJoin } from "../modules/antiraid/manager";
import { trackJoin } from "../modules/invites/tracker";
import { logBotAdd } from "../modules/logs/extra";
import { logMemberJoin } from "../modules/logs/members";
import { onBotAdd } from "../modules/security/antinuke";
import { findBotAdder, onBotJoin } from "../modules/security/bot-quarantine";
import { checkImpersonation } from "../modules/security/staff";
import { onVerificationJoin } from "../modules/security/verification";
import { syncMember } from "../modules/sync/manager";
import { sendWelcomeDm } from "../modules/welcome/join";
import type { EventHandler } from "../types";

const guildMemberAdd: EventHandler<"guildMemberAdd"> = {
  name: "guildMemberAdd",
  async execute(_client, member) {
    // Un bot n'a ni invitation, ni synchro, ni MP : quarantaine, puis anti-nuke
    // si l'auteur de l'ajout n'est pas de confiance.
    if (member.user.bot) {
      const addedBy = await findBotAdder(member).catch(() => null);
      await onBotJoin(member, addedBy).catch((err: unknown) =>
        logger.error({ err, memberId: member.id }, "Quarantaine du bot impossible"),
      );
      await logBotAdd(member, addedBy).catch((err) =>
        logger.error({ err, memberId: member.id }, "Log d'ajout de bot impossible"),
      );
      await onBotAdd(member.guild, addedBy, member).catch((err) =>
        logger.error({ err, memberId: member.id }, "Contrôle anti-nuke impossible"),
      );
      await onVerificationJoin(member).catch((err) =>
        logger.error({ err, memberId: member.id }, "Rôle de vérification du bot impossible"),
      );
      return;
    }

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
    // 4. Imitation du staff, échéance de vérification
    await checkImpersonation(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Contrôle anti-usurpation impossible"),
    );
    await onVerificationJoin(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Suivi de vérification impossible"),
    );
    // 5. Synchro immédiate si le compte est déjà lié
    await syncMember(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "Synchro à l'arrivée impossible"),
    );
    // 6. MP de bienvenue (après la synchro : le membre a déjà ses rôles)
    await sendWelcomeDm(member).catch((err) =>
      logger.error({ err, memberId: member.id }, "MP de bienvenue impossible"),
    );
  },
};

export default guildMemberAdd;
