import { logger } from "../lib/logger";
import { logAutomodAction } from "../modules/logs/automod";
import type { EventHandler } from "../types";

const autoModerationActionExecution: EventHandler<"autoModerationActionExecution"> = {
  name: "autoModerationActionExecution",
  async execute(_client, execution) {
    await logAutomodAction(execution).catch((err: unknown) =>
      logger.error(
        { err, guildId: execution.guild.id, ruleId: execution.ruleId },
        "Log AutoMod impossible",
      ),
    );
  },
};

export default autoModerationActionExecution;
