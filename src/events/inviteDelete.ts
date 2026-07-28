import { logger } from "../lib/logger";
import { deleteInvite } from "../modules/invites/cache";
import { logInviteDelete } from "../modules/logs/server";
import type { EventHandler } from "../types";

const inviteDelete: EventHandler<"inviteDelete"> = {
  name: "inviteDelete",
  async execute(_client, invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    await deleteInvite(guildId, invite.code);
    await logInviteDelete(invite).catch((err) =>
      logger.error({ err, code: invite.code }, "Log de suppression d'invitation impossible"),
    );
  },
};

export default inviteDelete;
