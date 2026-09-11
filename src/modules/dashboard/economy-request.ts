import { createHash } from "node:crypto";
import { pool } from "../../db";
import { deposit, purchase } from "../../lib/site-api";
export async function economyRequest(
  guildId: string,
  input: {
    action: "deposit" | "purchase";
    userId: string;
    credits?: number;
    reason?: string;
    itemId?: string;
    idempotencyKey: string;
  },
) {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        action: input.action,
        userId: input.userId,
        credits: input.credits,
        reason: input.reason,
        itemId: input.itemId,
      }),
    )
    .digest("hex");
  const inserted = await pool.query(
    "INSERT INTO bot_dashboard_requests(guild_id,request_key,fingerprint) VALUES($1,$2,$3) ON CONFLICT(guild_id,request_key) DO NOTHING RETURNING request_key",
    [guildId, input.idempotencyKey, fingerprint],
  );
  if (!inserted.rowCount) {
    const prior = (
      await pool.query<{ fingerprint: string; result: string | null }>(
        "SELECT fingerprint,result FROM bot_dashboard_requests WHERE guild_id=$1 AND request_key=$2",
        [guildId, input.idempotencyKey],
      )
    ).rows[0];
    if (!prior || prior.fingerprint !== fingerprint)
      return {
        ok: false as const,
        error: "Cette référence appartient à une autre opération.",
      };
    if (prior.result)
      return JSON.parse(prior.result) as
        | Awaited<ReturnType<typeof deposit>>
        | Awaited<ReturnType<typeof purchase>>;
    if (input.action === "purchase")
      return {
        ok: false as const,
        error:
          "Résultat de l’achat incertain. Vérifiez les commandes du site avant toute nouvelle tentative.",
      };
  }
  const result =
    input.action === "deposit"
      ? await deposit({
          key: "dashboard:" + guildId + ":" + input.idempotencyKey,
          discordId: input.userId,
          amount: input.credits!,
          reason: input.reason!,
        })
      : await purchase(input.userId, input.itemId!);
  // A purchase is not safely replayable when the remote answer is lost.
  if (result.ok)
    await pool.query(
      "UPDATE bot_dashboard_requests SET result=$3 WHERE guild_id=$1 AND request_key=$2",
      [guildId, input.idempotencyKey, JSON.stringify(result)],
    );
  return result;
}
