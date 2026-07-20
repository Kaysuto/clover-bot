import { logger } from "../lib/logger";
import { handleMessageXp } from "../modules/leveling/xp";
import type { EventHandler } from "../types";

const messageCreate: EventHandler<"messageCreate"> = {
  name: "messageCreate",
  async execute(_client, message) {
    await handleMessageXp(message).catch((err) =>
      logger.error({ err }, "Erreur lors du gain d'XP message"),
    );
  },
};

export default messageCreate;
