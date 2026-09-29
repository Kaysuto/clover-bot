import { logger } from "../lib/logger";
import { handleBoost } from "../modules/boost/manager";
import { handlePropulseurChange } from "../modules/boost/propulseur";
import { logMemberUpdate } from "../modules/logs/members";
import { guardSecurityRole } from "../modules/security/guard";
import { onMemberProfileChange, watchSensitiveRoles } from "../modules/security/staff";
import type { EventHandler } from "../types";

const guildMemberUpdate: EventHandler<"guildMemberUpdate"> = {
  name: "guildMemberUpdate",
  async execute(_client, oldMember, newMember) {
    await guardSecurityRole(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Contrôle du rôle de sécurité impossible"),
    );
    await watchSensitiveRoles(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Surveillance du staff impossible"),
    );
    await onMemberProfileChange(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Contrôle anti-usurpation impossible"),
    );
    await logMemberUpdate(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Log de modification de membre impossible"),
    );
    await handleBoost(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Récompense de boost impossible"),
    );
    await handlePropulseurChange(oldMember, newMember).catch((err) =>
      logger.error({ err, memberId: newMember.id }, "Grade Propulseur non mis à jour"),
    );
  },
};

export default guildMemberUpdate;
