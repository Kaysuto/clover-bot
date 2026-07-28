import { logger } from "../lib/logger";
import { logVoiceUpdate } from "../modules/logs/voice";
import { handleTempVoiceUpdate } from "../modules/tempvoice/manager";
import type { EventHandler } from "../types";

const voiceStateUpdate: EventHandler<"voiceStateUpdate"> = {
  name: "voiceStateUpdate",
  async execute(client, oldState, newState) {
    await handleTempVoiceUpdate(client, oldState, newState).catch((err) =>
      logger.error({ err }, "Erreur vocaux temporaires"),
    );
    await logVoiceUpdate(oldState, newState).catch((err) =>
      logger.error({ err }, "Log vocal impossible"),
    );
  },
};

export default voiceStateUpdate;
