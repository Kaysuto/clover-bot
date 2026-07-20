import type { EventHandler } from "../types";
import guildMemberAdd from "./guildMemberAdd";
import guildMemberRemove from "./guildMemberRemove";
import interactionCreate from "./interactionCreate";
import inviteCreate from "./inviteCreate";
import inviteDelete from "./inviteDelete";
import messageCreate from "./messageCreate";
import ready from "./ready";
import voiceStateUpdate from "./voiceStateUpdate";

export const events: EventHandler[] = [
  ready,
  interactionCreate,
  messageCreate,
  voiceStateUpdate,
  guildMemberAdd,
  guildMemberRemove,
  inviteCreate,
  inviteDelete,
];
