import { logger } from "../lib/logger";
import { logUserUpdate } from "../modules/logs/members";
import { onUserProfileChange } from "../modules/security/staff";
import type { EventHandler } from "../types";

const userUpdate: EventHandler<"userUpdate"> = {
  name: "userUpdate",
  async execute(client, oldUser, newUser) {
    await logUserUpdate(client, oldUser, newUser).catch((err) =>
      logger.error({ err, userId: newUser.id }, "Log de modification de profil impossible"),
    );
    const changed =
      oldUser.partial ||
      oldUser.username !== newUser.username ||
      oldUser.globalName !== newUser.globalName ||
      oldUser.avatar !== newUser.avatar;
    if (!changed) return;
    await onUserProfileChange(newUser).catch((err) =>
      logger.error({ err, userId: newUser.id }, "Contrôle anti-usurpation impossible"),
    );
  },
};

export default userUpdate;
