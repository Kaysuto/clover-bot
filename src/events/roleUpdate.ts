import { logger } from "../lib/logger";
import { logRoleUpdate } from "../modules/logs/server";
import type { EventHandler } from "../types";

const roleUpdate: EventHandler<"roleUpdate"> = {
  name: "roleUpdate",
  async execute(_client, oldRole, newRole) {
    await logRoleUpdate(oldRole, newRole).catch((err) =>
      logger.error({ err, roleId: newRole.id }, "Log de modification de rôle impossible"),
    );
  },
};

export default roleUpdate;
