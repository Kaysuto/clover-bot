import type { EventHandler } from "../types";
import channelCreate from "./channelCreate";
import channelDelete from "./channelDelete";
import channelUpdate from "./channelUpdate";
import guildBanAdd from "./guildBanAdd";
import guildBanRemove from "./guildBanRemove";
import guildMemberAdd from "./guildMemberAdd";
import guildMemberRemove from "./guildMemberRemove";
import guildMemberUpdate from "./guildMemberUpdate";
import interactionCreate from "./interactionCreate";
import inviteCreate from "./inviteCreate";
import inviteDelete from "./inviteDelete";
import messageCreate from "./messageCreate";
import ready from "./ready";
import roleCreate from "./roleCreate";
import roleDelete from "./roleDelete";
import roleUpdate from "./roleUpdate";
import userUpdate from "./userUpdate";
import voiceStateUpdate from "./voiceStateUpdate";

export const events: EventHandler[] = [
  ready,
  interactionCreate,
  messageCreate,
  voiceStateUpdate,
  guildMemberAdd,
  guildMemberRemove,
  guildMemberUpdate,
  userUpdate,
  guildBanAdd,
  guildBanRemove,
  channelCreate,
  channelDelete,
  channelUpdate,
  roleCreate,
  roleDelete,
  roleUpdate,
  inviteCreate,
  inviteDelete,
];
