import { and, gt, isNotNull } from "drizzle-orm";
import type { CloverClient } from "../../client";
import { db } from "../../db";
import { getGuildConfig } from "../../db/guild-config";
import { usersMeta } from "../../db/site-schema";
import { logger } from "../../lib/logger";
import { syncMember } from "./manager";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Répercute en ~1 min les liaisons/déliaisons faites sur le site : le job relit les
 * lignes users_meta modifiées depuis le dernier passage et resynchronise les membres
 * concernés (pseudo + rôle lié), au lieu d'attendre la synchro complète de 6 h.
 *
 * Le repère est volontairement en mémoire : après un redémarrage il repart 5 min en
 * arrière et la synchro complète `sync-minecraft` (runOnStart) rattrape tout le reste
 * — aucune ligne n'est perdue, au pire une resynchro sans effet est rejouée.
 */
let watermark = new Date(Date.now() - 5 * 60_000);

export async function tickSiteLinksDelta(client: CloverClient): Promise<void> {
  const rows = await db
    .select()
    .from(usersMeta)
    .where(and(isNotNull(usersMeta.discordId), gt(usersMeta.updatedAt, watermark)))
    .limit(200);
  if (rows.length === 0) return;

  // Le repère avance sur l'horloge de la base, jamais sur celle du bot (dérive d'horloge).
  let latest = watermark;
  for (const row of rows) {
    if (row.updatedAt && row.updatedAt > latest) latest = row.updatedAt;
  }

  for (const guild of client.guilds.cache.values()) {
    const cfg = await getGuildConfig(guild.id);
    for (const row of rows) {
      const member = await guild.members.fetch(row.discordId!).catch(() => null);
      if (!member || member.user.bot) continue;
      await syncMember(member, cfg);
      await sleep(300); // même throttle que la synchro complète
    }
  }

  watermark = latest;
  logger.info({ count: rows.length }, "Delta des liaisons site appliqué");
}
