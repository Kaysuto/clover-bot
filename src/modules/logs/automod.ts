import {
  type AutoModerationActionExecution,
  AutoModerationActionType,
  AutoModerationRuleTriggerType,
} from "discord.js";
import { sendLog } from "./channel";
import { LOG_COLOR, logEmbed, trim, userLine } from "./format";

/** Libellés français des déclencheurs AutoMod. */
const TRIGGER_LABELS: Record<AutoModerationRuleTriggerType, string> = {
  [AutoModerationRuleTriggerType.Keyword]: "Mot ou motif interdit",
  [AutoModerationRuleTriggerType.Spam]: "Spam",
  [AutoModerationRuleTriggerType.KeywordPreset]: "Liste Discord",
  [AutoModerationRuleTriggerType.MentionSpam]: "Mentions massives",
  [AutoModerationRuleTriggerType.MemberProfile]: "Profil du membre",
};

/** Libellés français des actions appliquées par Discord. */
const ACTION_LABELS: Record<AutoModerationActionType, string> = {
  [AutoModerationActionType.BlockMessage]: "Message bloqué",
  [AutoModerationActionType.SendAlertMessage]: "Alerte envoyée",
  [AutoModerationActionType.Timeout]: "Membre exclu temporairement",
  [AutoModerationActionType.BlockMemberInteraction]: "Interactions bloquées",
};

/** 🛡️ Déclenchement d'une règle AutoMod (règle native, action côté Discord). */
export async function logAutomodAction(
  execution: AutoModerationActionExecution,
): Promise<void> {
  const embed = logEmbed(LOG_COLOR.warn, "🛡️ AutoMod déclenché")
    .setDescription(
      execution.user
        ? userLine(execution.user)
        : `<@${execution.userId}> · \`ID ${execution.userId}\``,
    )
    .addFields(
      {
        name: "Règle",
        value: trim(execution.autoModerationRule?.name ?? `ID ${execution.ruleId}`, 256),
        inline: true,
      },
      {
        name: "Déclencheur",
        value: TRIGGER_LABELS[execution.ruleTriggerType],
        inline: true,
      },
      {
        name: "Action",
        value: ACTION_LABELS[execution.action.type],
        inline: true,
      },
    );

  if (execution.channelId) {
    embed.addFields({ name: "Salon", value: `<#${execution.channelId}>`, inline: true });
  }
  if (execution.matchedKeyword) {
    embed.addFields({
      name: "Terme détecté",
      value: trim(`\`${execution.matchedKeyword}\``, 256),
      inline: true,
    });
  }
  // `content` et `matchedContent` restent vides sans l'intent MessageContent,
  // volontairement absent : le champ n'est ajouté que si Discord le fournit.
  const excerpt = execution.matchedContent || execution.content;
  if (excerpt) {
    embed.addFields({ name: "Extrait", value: trim(excerpt) });
  }

  await sendLog(execution.guild, "automod", embed.setFooter({ text: `ID ${execution.userId}` }));
}
