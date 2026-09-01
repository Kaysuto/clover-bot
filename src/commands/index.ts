import type { Command } from "../types";
import config from "./admin/config";
import ping from "./admin/ping";
import reseau from "./admin/reseau";
import statut from "./admin/statut";
import giveaway from "./giveaways/giveaway";
import invites from "./invites/invites";
import classement from "./leveling/classement";
import rank from "./leveling/rank";
import casier from "./moderation/casier";
import clear from "./moderation/clear";
import boutique from "./shop/boutique";
import sanction from "./moderation/sanction";
import suggestion from "./suggestions/suggestion";
import delier from "./sync/delier";
import joueur from "./sync/joueur";
import lier from "./sync/lier";
import sync from "./sync/sync";
import ticket from "./tickets/ticket";
import voc from "./voice/voc";
import votes from "./vote/votes";

export const commands: Command[] = [
  ping,
  statut,
  config,
  reseau,
  rank,
  classement,
  giveaway,
  invites,
  sanction,
  casier,
  clear,
  sync,
  lier,
  delier,
  joueur,
  voc,
  ticket,
  votes,
  suggestion,
  boutique,
];
