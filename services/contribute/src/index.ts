/**
 * RawJobs contribution inbox (Cloudflare Worker).
 *
 * Apps send the company boards their users added with "Add by link". The inbox only checks the
 * shape and keeps them; the directory workflow pulls them, live-checks each board, adds good ones
 * to the shared list and acknowledges what it processed. No accounts, no personal data: a board
 * is a hiring system, a slug and a name.
 *
 *   POST /v1/contributions   { client?, boards: [{ ats, slug, region?, shard?, site?, name? }] }  (public)
 *   GET  /v1/pending         list waiting contributions, 500 a page; ?cursor= for the next  (Bearer INBOX_TOKEN)
 *   POST /v1/ack             { ids: [...] } remove processed contributions                   (Bearer INBOX_TOKEN)
 *
 * Abuse limits: 20 requests a minute per IP (Cloudflare rate limiter; the IP is not stored), at
 * most 25 boards a request, at most DAILY_CAP boards accepted a day for everyone together, and a
 * board already received in the last 7 days is skipped. Only boards on the hiring systems the
 * directory takes (SCANNABLE) are accepted, stored as a system and a slug (plus shard and site
 * where the system needs them), never as a free-form link.
 *
 * KV keys: "c:…" contributions (the only keys /v1/pending lists) and "day:YYYY-MM-DD", the boards
 * accepted that day (for the cap and the dedupe). One accepted request costs two KV writes, which
 * matters on the free plan (1,000 writes a day).
 */

export interface Env {
  INBOX: KVNamespace;
  /** Workers rate limiting binding; optional so local dev works without it. */
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  INBOX_TOKEN: string;
  /** Most boards accepted per UTC day, for everyone together (wrangler.toml [vars]). Default 2000. */
  DAILY_CAP?: string;
}

type Board = { ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string };

/**
 * The hiring systems the directory workflow accepts: ATS_TYPES in packages/core/src/schema.ts, with the
 * same shard and site rules as scripts/catalog/contributions.ts (the Worker can't import them; a test
 * keeps them in step). Public job boards are never shared.
 */
export const SCANNABLE = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "workable",
  "recruitee",
  "personio",
  "bamboohr",
  "breezy",
  "successfactors",
  "teamtailor",
  "comeet",
  "oracle",
  "icims",
  "taleo",
  "jobvite",
  "pinpoint",
  "rippling",
  "jazzhr",
  "zoho",
  "hibob",
  "freshteam",
]);
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** What `shard` may look like per system (the rest have none). */
const SHARD: Record<string, RegExp> = { workday: /^wd\d{1,3}$/, oracle: /^[a-z0-9-]{2,30}$/, successfactors: /^[a-z0-9.-]{1,60}\.(successfactors|sapsf)\.(com|eu)$/ };
/** Systems that need `site` (the rest may carry one). */
const NEEDS_SITE = new Set(["workday", "taleo", "comeet"]);
/** The app's name and, optionally, its version ("rawjobs", "rawjobs/0.1.0"; apps from before the rename send "job-hunter"). Anything else is dropped. */
const CLIENT = /^(rawjobs|job-hunter)(\/\d{1,3}\.\d{1,3}\.\d{1,4})?$/;
const MAX_BODY = 20_000;
const MAX_BOARDS = 25;
const KEEP_DAYS = 30;
const DEFAULT_DAILY_CAP = 2000;
const DEDUPE_DAYS = 7;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The board as stored, or null when it isn't a board we could ever scan. */
function clean(b: unknown): Board | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (typeof o.ats !== "string" || !SCANNABLE.has(o.ats)) return null;
  if (typeof o.slug !== "string" || !SLUG.test(o.slug)) return null;
  const shard = SHARD[o.ats];
  if (o.shard !== undefined && !(shard && typeof o.shard === "string" && shard.test(o.shard))) return null;
  if ((o.ats === "workday" || o.ats === "oracle") && o.shard === undefined) return null;
  if (o.site !== undefined && !(typeof o.site === "string" && SLUG.test(o.site))) return null;
  if (NEEDS_SITE.has(o.ats) && o.site === undefined) return null;
  const name =
    typeof o.name === "string"
      ? o.name
          // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
          .replace(/[\u0000-\u001f<>]/g, "")
          .trim()
          .slice(0, 100)
      : "";
  return {
    ats: o.ats,
    slug: o.slug,
    ...(o.region === "eu" ? { region: "eu" } : {}),
    ...(typeof o.shard === "string" ? { shard: o.shard } : {}),
    ...(typeof o.site === "string" ? { site: o.site } : {}),
    ...(name ? { name } : {}),
  };
}

/** Constant-time comparison for the workflow's token. */
function authorized(req: Request, env: Env): boolean {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const want = env.INBOX_TOKEN ?? "";
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function contribute(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json({ error: "Too many requests, try again in a minute." }, 429);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Request too large." }, 413);
  let body: { client?: unknown; boards?: unknown[] };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "Body must be a JSON object." }, 400);
  const seen = new Set<string>();
  const boards: { board: Board; key: string }[] = [];
  for (const raw of (Array.isArray(body.boards) ? body.boards : []).slice(0, MAX_BOARDS)) {
    const b = clean(raw);
    const key = b && boardKey(b);
    if (!b || !key || seen.has(key)) continue;
    seen.add(key);
    boards.push({ board: b, key });
  }
  if (!boards.length) return json({ error: "No boards we can use." }, 400);

  // Skip boards someone already sent in the last week: the workflow has them (or rejected them).
  const now = Date.now();
  const days = Array.from({ length: DEDUPE_DAYS }, (_, i) => `day:${new Date(now - i * 86_400_000).toISOString().slice(0, 10)}`);
  const logs = await Promise.all(days.map(async (k) => parseDay(await env.INBOX.get(k))));
  const recent = new Set(logs.flat());
  const fresh = boards.filter((b) => !recent.has(b.key));
  const duplicates = boards.length - fresh.length;
  if (!fresh.length) return json({ received: 0, duplicates }, 202);

  // A cap for everyone together, so a flood can't fill the inbox. KV isn't atomic, so two requests
  // at the same moment can go slightly over (or miss a dedupe entry); that's fine for a cap.
  // All or nothing: the app keeps a rejected batch in its outbox and sends it again later.
  const today = logs[0]!;
  if (today.length + fresh.length > dailyCap(env)) return json({ error: "The inbox is full for today. Your app will try again later." }, 429);

  // No IP or user data is stored: only the boards, when they arrived, and the app name/version if valid.
  const client = typeof body.client === "string" && CLIENT.test(body.client) ? body.client : undefined;
  const id = `c:${now}:${crypto.randomUUID()}`;
  const record = { boards: fresh.map((b) => b.board), received_at: new Date(now).toISOString(), ...(client ? { client } : {}) };
  await env.INBOX.put(id, JSON.stringify(record), { expirationTtl: KEEP_DAYS * 86_400 });
  await env.INBOX.put(days[0]!, JSON.stringify([...today, ...fresh.map((b) => b.key)]), { expirationTtl: (DEDUPE_DAYS + 1) * 86_400 });
  return json({ received: fresh.length, duplicates }, 202);
}

/** A day's accepted board keys (the dedupe log); unreadable values count as empty. */
function parseDay(value: string | null): string[] {
  try {
    const list = value ? (JSON.parse(value) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const boardKey = (b: Board) => `${b.ats}:${b.slug}|${b.shard ?? ""}|${b.site ?? ""}`.toLowerCase();

function dailyCap(env: Env): number {
  const n = Number(env.DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

async function pending(req: Request, env: Env): Promise<Response> {
  // A cursor, not "list again after acknowledging": KV lists are eventually consistent, so a fresh
  // list could hand back keys that were just removed.
  const cursor = new URL(req.url).searchParams.get("cursor") || undefined;
  const list = await env.INBOX.list({ prefix: "c:", limit: 500, cursor });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const value = await env.INBOX.get(k.name);
      if (!value) return null;
      try {
        return { id: k.name, ...(JSON.parse(value) as { boards: Board[]; received_at: string }) };
      } catch {
        // A damaged record mustn't fail the whole list: hand it over empty, so it's acknowledged and removed.
        return { id: k.name, boards: [], received_at: "" };
      }
    }),
  );
  return json({ items: items.filter(Boolean), more: !list.list_complete, ...(list.list_complete ? {} : { cursor: list.cursor }) });
}

async function ack(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && x.startsWith("c:")).slice(0, 1000);
  await Promise.all(ids.map((id) => env.INBOX.delete(id)));
  return json({ removed: ids.length });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    try {
      if (req.method === "POST" && pathname === "/v1/contributions") return await contribute(req, env);
      if (req.method === "GET" && pathname === "/v1/pending") return authorized(req, env) ? await pending(req, env) : json({ error: "Unauthorized" }, 401);
      if (req.method === "POST" && pathname === "/v1/ack") return authorized(req, env) ? await ack(req, env) : json({ error: "Unauthorized" }, 401);
      if (req.method === "GET" && pathname === "/") return new Response("RawJobs contribution inbox. POST /v1/contributions\n", { headers: { "content-type": "text/plain" } });
      return json({ error: "Not found" }, 404);
    } catch (err) {
      // The details go to the Worker's logs, not to the caller.
      console.error(err);
      return json({ error: "Something went wrong; please try again later." }, 500);
    }
  },
};
