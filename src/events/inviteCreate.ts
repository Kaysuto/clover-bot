import { upsertInvite } from "../modules/invites/cache";
import type { EventHandler } from "../types";

const inviteCreate: EventHandler<"inviteCreate"> = {
  name: "inviteCreate",
  async execute(_client, invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    await upsertInvite(guildId, invite.code, invite.inviterId, invite.uses ?? 0);
  },
};

export default inviteCreate;
