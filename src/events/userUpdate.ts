import { logger } from "../lib/logger";
import { logUserUpdate } from "../modules/logs/members";
import type { EventHandler } from "../types";

const userUpdate: EventHandler<"userUpdate"> = {
  name: "userUpdate",
  async execute(client, oldUser, newUser) {
    await logUserUpdate(client, oldUser, newUser).catch((err) =>
      logger.error({ err, userId: newUser.id }, "Log de modification de profil impossible"),
    );
  },
};

export default userUpdate;
