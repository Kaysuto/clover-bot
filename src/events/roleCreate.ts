import { logger } from "../lib/logger";
import { logRoleCreate } from "../modules/logs/server";
import { onRoleCreate } from "../modules/security/antinuke";
import type { EventHandler } from "../types";

const roleCreate: EventHandler<"roleCreate"> = {
  name: "roleCreate",
  async execute(_client, role) {
    await Promise.all([
      onRoleCreate(role).catch((err) =>
        logger.error({ err, roleId: role.id }, "Contrôle anti-nuke impossible"),
      ),
      logRoleCreate(role).catch((err) =>
        logger.error({ err, roleId: role.id }, "Log de création de rôle impossible"),
      ),
    ]);
  },
};

export default roleCreate;
