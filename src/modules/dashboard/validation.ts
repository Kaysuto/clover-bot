import { z } from "zod";
const snowflake = z.string().regex(/^\d{17,20}$/);
const optionalId = z
  .union([snowflake, z.literal(""), z.null()])
  .transform((v) => v || null);
export const configPatch = z
  .object({
    welcomeDmEnabled: z.boolean().optional(),
    welcomeDmMessage: z
      .string()
      .max(1500)
      .nullable()
      .transform((v) => v || null)
      .optional(),
    leaveSurveyEnabled: z.boolean().optional(),
    leaveFeedbackChannelId: optionalId.optional(),
    xpMin: z.number().int().min(1).max(1000).optional(),
    xpMax: z.number().int().min(1).max(1000).optional(),
    xpCooldownSec: z.number().int().min(0).max(3600).optional(),
    voiceXpPerMin: z.number().int().min(0).max(100).optional(),
    levelupMessage: z.string().min(1).max(500).optional(),
    inviteXp: z.number().int().min(0).max(10000).optional(),
    inviteCredits: z.number().int().min(0).max(100).optional(),
    inviteMaturityDays: z.number().int().min(7).max(90).optional(),
    inviteMinAccountAgeDays: z.number().int().min(0).max(365).optional(),
    inviteRequireLink: z.boolean().optional(),
    inviteMinLevel: z.number().int().min(0).max(100).optional(),
    inviteMonthlyCap: z.number().int().min(1).max(1000).optional(),
    ticketCategoryId: optionalId.optional(),
    ticketArchiveChannelId: optionalId.optional(),
    ticketSupportRoleId: optionalId.optional(),
    logChannelId: optionalId.optional(),
    gameEventChannelId: optionalId.optional(),
    sanctionPropagateMc: z.boolean().optional(),
    muteRoleId: optionalId.optional(),
    mcBanCommand: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]+$/)
      .optional(),
    mcUnbanCommand: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]+$/)
      .optional(),
    syncNicknames: z.boolean().optional(),
    linkedRoleId: optionalId.optional(),
    suggestionChannelId: optionalId.optional(),
  })
  .strict();
export const adminEnvelope = z
  .object({
    operation: z.string().max(40),
    guildId: snowflake,
    actorId: snowflake.optional(),
  })
  .passthrough();
export const period = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    unit: z.enum(["days", "months", "years"]).optional(),
  })
  .refine(
    (v) =>
      v.from <= v.to &&
      Date.parse(v.to) - Date.parse(v.from) <= 3660 * 86400000,
    "Période invalide.",
  );
export { snowflake };
