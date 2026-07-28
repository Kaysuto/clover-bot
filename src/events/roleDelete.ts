import { logger } from "../lib/logger";
import { logRoleDelete } from "../modules/logs/server";
import type { EventHandler } from "../types";

const roleDelete: EventHandler<"roleDelete"> = {
  name: "roleDelete",
  async execute(_client, role) {
    await logRoleDelete(role).catch((err) =>
      logger.error({ err, roleId: role.id }, "Log de suppression de rôle impossible"),
    );
  },
};

export default roleDelete;
