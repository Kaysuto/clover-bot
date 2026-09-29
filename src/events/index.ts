import type { EventHandler } from "../types";
import autoModerationActionExecution from "./autoModerationActionExecution";
import channelCreate from "./channelCreate";
import channelDelete from "./channelDelete";
import channelUpdate from "./channelUpdate";
import emojiCreate from "./emojiCreate";
import emojiDelete from "./emojiDelete";
import emojiUpdate from "./emojiUpdate";
import guildBanAdd from "./guildBanAdd";
import guildBanRemove from "./guildBanRemove";
import guildCreate from "./guildCreate";
import guildDelete from "./guildDelete";
import guildMemberAdd from "./guildMemberAdd";
import guildMemberRemove from "./guildMemberRemove";
import guildMemberUpdate from "./guildMemberUpdate";
import guildUpdate from "./guildUpdate";
import interactionCreate from "./interactionCreate";
import inviteCreate from "./inviteCreate";
import inviteDelete from "./inviteDelete";
import messageCreate from "./messageCreate";
import messageDelete from "./messageDelete";
import messageDeleteBulk from "./messageDeleteBulk";
import messageUpdate from "./messageUpdate";
import ready from "./ready";
import roleCreate from "./roleCreate";
import roleDelete from "./roleDelete";
import roleUpdate from "./roleUpdate";
import stickerCreate from "./stickerCreate";
import stickerDelete from "./stickerDelete";
import stickerUpdate from "./stickerUpdate";
import threadCreate from "./threadCreate";
import threadDelete from "./threadDelete";
import threadUpdate from "./threadUpdate";
import userUpdate from "./userUpdate";
import voiceStateUpdate from "./voiceStateUpdate";
import webhooksUpdate from "./webhooksUpdate";

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
  guildCreate,
  guildDelete,
  channelCreate,
  channelDelete,
  channelUpdate,
  roleCreate,
  roleDelete,
  roleUpdate,
  inviteCreate,
  inviteDelete,
  autoModerationActionExecution,
  emojiCreate,
  emojiDelete,
  emojiUpdate,
  guildUpdate,
  messageDelete,
  messageDeleteBulk,
  messageUpdate,
  stickerCreate,
  stickerDelete,
  stickerUpdate,
  threadCreate,
  threadDelete,
  threadUpdate,
  webhooksUpdate,
];
