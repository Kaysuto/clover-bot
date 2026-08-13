import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fichier de vie, réécrit tant que la passerelle Discord répond. Le
 * HEALTHCHECK du conteneur ne regarde que sa date : le bot n'expose aucun
 * port, et un process vivant mais déconnecté de Discord ne rend aucun service.
 * `tmpdir()` pour que le chemin soit le même dans l'image et en dev Windows.
 */
export const HEARTBEAT_FILE = join(tmpdir(), "clover-bot.alive");

export async function touchHeartbeat(): Promise<void> {
  await writeFile(HEARTBEAT_FILE, String(Date.now()), "utf8");
}
