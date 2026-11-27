import { getJson } from "./api";

/** A careers board as the directory finds it again: hiring system, board name, and (when needed) shard, site and EU region. */
export type MoveBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string };

/** What the local server said: queued to share with the next directory update, or why not. */
export type ShareMoveResult = { queued: true } | { queued: false; reason: string };

/** Only what the directory needs to find the board: never a careers URL or anything else the caller holds. */
const boardOnly = (b: MoveBoard): MoveBoard => ({
  ats: b.ats,
  slug: b.slug,
  ...(b.region === "eu" ? { region: "eu" } : {}),
  ...(b.shard ? { shard: b.shard } : {}),
  ...(b.site ? { site: b.site } : {}),
});

/**
 * After you confirm a company's new careers link: queue "this company's board moved from `from` to
 * `to`" to share with the directory (POST /api/directory/moves). The server only queues it; it's sent
 * with the next regular directory update, and only while Settings → Sharing is on.
 *
 * Fire and forget: it never throws and never rejects. Call it as `void shareMove(…)`; the answer
 * is there for a test or a log, and a server that's down or a board it won't take is just `queued: false`.
 */
export async function shareMove(name: string, from: MoveBoard, to: MoveBoard): Promise<ShareMoveResult> {
  const r = await getJson("POST /api/directory/moves", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, from: boardOnly(from), to: boardOnly(to) }),
  });
  if (r.ok && r.data.queued) return { queued: true };
  return { queued: false, reason: r.ok ? ("reason" in r.data && r.data.reason) || `HTTP ${r.status}` : r.error };
}
