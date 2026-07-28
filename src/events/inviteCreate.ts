import { logger } from "../lib/logger";
import { upsertInvite } from "../modules/invites/cache";
import { logInviteCreate } from "../modules/logs/server";
import type { EventHandler } from "../types";

const inviteCreate: EventHandler<"inviteCreate"> = {
  name: "inviteCreate",
  async execute(_client, invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    await upsertInvite(guildId, invite.code, invite.inviterId, invite.uses ?? 0);
    await logInviteCreate(invite).catch((err) =>
      logger.error({ err, code: invite.code }, "Log de création d'invitation impossible"),
    );
  },
};

export default inviteCreate;
