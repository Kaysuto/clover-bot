import { logger } from "../lib/logger";
import { handleMessageXp } from "../modules/leveling/xp";
import { recordMessage } from "../modules/dashboard/statistics";
import { inspectMessage } from "../modules/security/messages";
import type { EventHandler } from "../types";

const messageCreate: EventHandler<"messageCreate"> = {
  name: "messageCreate",
  async execute(_client, message) {
    // Contrôle de sécurité d'abord : un message supprimé ne rapporte ni XP ni statistique.
    const removed = await inspectMessage(message).catch((err) => {
      logger.error({ err }, "Contrôle de sécurité du message impossible");
      return false;
    });
    if (removed) return;
    await recordMessage(message).catch((err) => logger.error({ err }, "Collecte des statistiques impossible"));
    await handleMessageXp(message).catch((err) =>
      logger.error({ err }, "Erreur lors du gain d'XP message"),
    );
  },
};

export default messageCreate;
