import { deleteInvite } from "../modules/invites/cache";
import type { EventHandler } from "../types";

const inviteDelete: EventHandler<"inviteDelete"> = {
  name: "inviteDelete",
  async execute(_client, invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    await deleteInvite(guildId, invite.code);
  },
};

export default inviteDelete;
