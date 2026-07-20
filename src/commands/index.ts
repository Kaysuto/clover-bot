import type { Command } from "../types";
import config from "./admin/config";
import ping from "./admin/ping";
import statut from "./admin/statut";
import giveaway from "./giveaways/giveaway";
import invites from "./invites/invites";
import classement from "./leveling/classement";
import rank from "./leveling/rank";
import sync from "./sync/sync";
import ticket from "./tickets/ticket";
import voc from "./voice/voc";

export const commands: Command[] = [
  ping,
  statut,
  config,
  rank,
  classement,
  giveaway,
  invites,
  sync,
  voc,
  ticket,
];
