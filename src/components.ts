import { handleGiveawayComponent } from "./modules/giveaways/manager";
import { handleLeaderboardComponent } from "./modules/leveling/leaderboard";
import { handleTempVoiceComponent } from "./modules/tempvoice/components";
import { handleTicketComponent } from "./modules/tickets/manager";
import type { ComponentHandler } from "./types";

/** Routage des interactions de composants par préfixe de customId. */
export const componentHandlers: Record<string, ComponentHandler> = {
  giveaway: handleGiveawayComponent,
  ticket: handleTicketComponent,
  lb: handleLeaderboardComponent,
  voc: handleTempVoiceComponent,
};
