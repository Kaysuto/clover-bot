import { logger } from "../lib/logger";
import { logRoleUpdate } from "../modules/logs/server";
import { onRoleUpdate } from "../modules/security/antinuke";
import type { EventHandler } from "../types";

const roleUpdate: EventHandler<"roleUpdate"> = {
  name: "roleUpdate",
  async execute(_client, oldRole, newRole) {
    await Promise.all([
      onRoleUpdate(oldRole, newRole).catch((err) =>
        logger.error({ err, roleId: newRole.id }, "Contrôle anti-nuke impossible"),
      ),
      logRoleUpdate(oldRole, newRole).catch((err) =>
        logger.error({ err, roleId: newRole.id }, "Log de modification de rôle impossible"),
      ),
    ]);
  },
};

export default roleUpdate;
