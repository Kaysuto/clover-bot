import { handleApplicationComponent } from "./modules/applications/manager";
import { handleGiveawayComponent } from "./modules/giveaways/manager";
import { handleLeaderboardComponent } from "./modules/leveling/leaderboard";
import { handleSuggestionComponent } from "./modules/suggestions/manager";
import { handleTempVoiceComponent } from "./modules/tempvoice/components";
import { handleTicketComponent } from "./modules/tickets/manager";
import { handleLeaveComponent } from "./modules/welcome/leave";
import type { ComponentHandler, DmComponentHandler } from "./types";

/** Routage des interactions de composants par préfixe de customId. */
export const componentHandlers: Record<string, ComponentHandler> = {
  giveaway: handleGiveawayComponent,
  ticket: handleTicketComponent,
  lb: handleLeaderboardComponent,
  voc: handleTempVoiceComponent,
  sugg: handleSuggestionComponent,
  cand: handleApplicationComponent,
};

/**
 * Routage des composants publiés en message privé. Table distincte des
 * précédents : une interaction en MP n'a ni guilde ni membre, donc aucun des
 * handlers ci-dessus (typés « en guilde ») ne peut la traiter.
 */
export const dmComponentHandlers: Record<string, DmComponentHandler> = {
  depart: handleLeaveComponent,
};
