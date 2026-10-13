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
 *   POST /v1/moves           { client?, moves: [{ name, from: Board, to: Board }] }  (public)
 *   GET  /v1/moves/pending   list waiting move reports, 500 a page; ?cursor= for the next    (Bearer INBOX_TOKEN)
 *   POST /v1/moves/ack       { ids: [...] } remove processed move reports                    (Bearer INBOX_TOKEN)
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
 *
 * Move reports ("this company's careers page moved from board A to board B"): at most 10 a request,
 * body at most 10 KB, the same board rules and name cleaning as contributions, and the same rate
 * limiter. One KV record per move, "m:<fromKey>><toKey>", kept 30 days:
 * { name, from, to, first_at, last_at, reporters }. `reporters` holds up to 20 keyed hashes,
 * HMAC-SHA256(REPORTER_SECRET, ip + "|" + fromKey) cut to 16 hex characters, so the workflow can
 * count distinct reporters. No IP is stored, and the hashes never leave the Worker
 * (/v1/moves/pending returns only how many there are). A repeat from the same reporter writes
 * nothing. "md:YYYY-MM-DD" counts the new move records that day, capped at MOVES_DAILY_CAP. KV
 * writes: one per new or changed record, plus the day counter when a record is new.
 *
 * Settings: INBOX_TOKEN (secret, shared with the workflow), REPORTER_SECRET (secret, keys the
 * reporter hashes; without it /v1/moves answers 503), DAILY_CAP and MOVES_DAILY_CAP (wrangler.toml
 * [vars]).
 */

export interface Env {
  INBOX: KVNamespace;
  /** Workers rate limiting binding; optional so local dev works without it. */
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  INBOX_TOKEN: string;
  /** Most boards accepted per UTC day, for everyone together (wrangler.toml [vars]). Default 2000. */
  DAILY_CAP?: string;
  /** Key for the reporter hashes on move reports (a secret). Without it, /v1/moves answers 503. */
  REPORTER_SECRET?: string;
  /** Most new move records per UTC day, for everyone together (wrangler.toml [vars]). Default 100. */
  MOVES_DAILY_CAP?: string;
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
  "join",
  "paylocity",
  "paycom",
  "hireology",
  "ukg",
  "eightfold",
  "phenom",
  "careerplug",
  "dayforce",
  "adp",
  "applicantpro",
  "paycor",
  "hiringthing",
]);
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** What `shard` may look like per system (the rest have none). */
const SHARD: Record<string, RegExp> = {
  workday: /^wd\d{1,3}$/,
  oracle: /^[a-z0-9-]{2,30}$/,
  successfactors: /^[a-z0-9.-]{1,60}\.(successfactors\.(com|eu)|sapsf\.(com|eu|cn))$/,
  // JOIN's numeric company id.
  join: /^\d{1,10}$/,
  // UKG Pro Recruiting's host (recruiting2.ultipro.com, acme.rec.pro.ukg.net).
  ukg: /^[a-z0-9-]{1,60}\.(ultipro\.com|rec\.pro\.ukg\.net)$/,
  // Eightfold's tenant domain (netflix.com), needed by its API.
  eightfold: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  // Dayforce's site culture, when it isn't en-US.
  dayforce: /^[a-z]{2}-[A-Z]{2}$/,
  // ApplicantPro's domain (it's also sold as iSolved Hire).
  applicantpro: /^(applicantpro|isolvedhire)\.com$/,
  // Zoho Recruit's data centre, when it isn't .com.
  zoho: /^(eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/,
};
/** Systems that need `site` (the rest may carry one). */
const NEEDS_SITE = new Set(["workday", "taleo", "comeet", "ukg", "dayforce", "adp"]);
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
  if ((o.ats === "workday" || o.ats === "oracle" || o.ats === "ukg") && o.shard === undefined) return null;
  if (o.site !== undefined && !(typeof o.site === "string" && SLUG.test(o.site))) return null;
  if (NEEDS_SITE.has(o.ats) && o.site === undefined) return null;
  const name = cleanName(o.name, 100);
  return {
    ats: o.ats,
    slug: o.slug,
    ...(o.region === "eu" ? { region: "eu" } : {}),
    ...(typeof o.shard === "string" ? { shard: o.shard } : {}),
    ...(typeof o.site === "string" ? { site: o.site } : {}),
    ...(name ? { name } : {}),
  };
}

/** A company name without control characters or angle brackets, trimmed and cut to `max`; "" when there is none. */
function cleanName(raw: unknown, max: number): string {
  return typeof raw === "string"
    ? raw
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
        .replace(/[\u0000-\u001f<>]/g, "")
        .trim()
        .slice(0, max)
    : "";
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

// ── Move reports ──────────────────────────────────────────────────────────────────────────────

const MAX_MOVES_BODY = 10_000;
const MAX_MOVES = 10;
const MAX_MOVE_NAME = 120;
const MAX_REPORTERS = 20;
const DEFAULT_MOVES_DAILY_CAP = 100;
/** KV keys are at most 512 bytes; a move whose key would be longer can't be stored. */
const MAX_KEY = 512;

type MoveBoard = Omit<Board, "name">;
type MoveRecord = { name: string; from: MoveBoard; to: MoveBoard; first_at: string; last_at: string; reporters: string[] };

/** A board in a move: the contribution rules, without the name (the move carries it). */
function moveBoard(raw: unknown): MoveBoard | null {
  const b = clean(raw);
  if (!b) return null;
  const { name: _name, ...board } = b;
  return board;
}

/** The move as stored and its KV key, or null when it isn't well-shaped. */
function cleanMove(raw: unknown): { key: string; fromKey: string; name: string; from: MoveBoard; to: MoveBoard } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = cleanName(o.name, MAX_MOVE_NAME);
  const from = moveBoard(o.from);
  const to = moveBoard(o.to);
  if (!name || !from || !to) return null;
  const fromKey = boardKey(from);
  const toKey = boardKey(to);
  if (fromKey === toKey) return null;
  const key = `m:${fromKey}>${toKey}`;
  if (new TextEncoder().encode(key).length > MAX_KEY) return null;
  return { key, fromKey, name, from, to };
}

/** HMAC-SHA256(secret, ip + "|" + fromKey) as hex, first 16 characters: tells reporters apart without keeping the IP. */
async function reporterHash(secret: string, ip: string, fromKey: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ip}|${fromKey}`)));
  return Array.from(sig, (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function movesDailyCap(env: Env): number {
  const n = Number(env.MOVES_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MOVES_DAILY_CAP;
}

function parseMove(value: string | null): MoveRecord | null {
  if (!value) return null;
  try {
    const r = JSON.parse(value) as MoveRecord;
    return r && typeof r === "object" && Array.isArray(r.reporters) ? r : null;
  } catch {
    return null;
  }
}

async function reportMoves(req: Request, env: Env): Promise<Response> {
  // Without the key the reporter hashes can't be made, and we never store reporters any other way.
  if (!env.REPORTER_SECRET) return json({ error: "Move reports aren't open yet. Your app will try again later." }, 503);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json({ error: "Too many requests, try again in a minute." }, 429);
  const text = await req.text();
  if (text.length > MAX_MOVES_BODY) return json({ error: "Request too large." }, 400);
  let body: { moves?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.moves)) return json({ error: "Body must have a list of moves." }, 400);
  if (body.moves.length > MAX_MOVES) return json({ error: `At most ${MAX_MOVES} moves a request.` }, 400);

  const seen = new Set<string>();
  const moves: NonNullable<ReturnType<typeof cleanMove>>[] = [];
  let skipped = 0;
  for (const raw of body.moves) {
    const m = cleanMove(raw);
    if (!m || seen.has(m.key)) {
      skipped++;
      continue;
    }
    seen.add(m.key);
    moves.push(m);
  }
  if (!moves.length) return json({ error: "No moves we can use." }, 400);

  const now = new Date();
  const at = now.toISOString();
  const dayKey = `md:${at.slice(0, 10)}`;
  const [existing, todayRaw] = await Promise.all([Promise.all(moves.map((m) => env.INBOX.get(m.key))), env.INBOX.get(dayKey)]);
  const writes: { key: string; record: MoveRecord }[] = [];
  let created = 0;
  for (const [i, m] of moves.entries()) {
    const reporter = await reporterHash(env.REPORTER_SECRET, ip, m.fromKey);
    const old = parseMove(existing[i] ?? null);
    if (!old) {
      created++;
      writes.push({ key: m.key, record: { name: m.name, from: m.from, to: m.to, first_at: at, last_at: at, reporters: [reporter] } });
    } else if (old.reporters.includes(reporter) || old.reporters.length >= MAX_REPORTERS) {
      // A repeat (or a full list) changes nothing, so it costs no write.
      skipped++;
    } else {
      writes.push({ key: m.key, record: { ...old, last_at: at, reporters: [...old.reporters, reporter] } });
    }
  }

  // The cap counts new records for everyone together. All or nothing, like contributions: the app
  // keeps the reports and sends them again later. KV isn't atomic, so a burst can go slightly over.
  const today = Number(todayRaw) || 0;
  if (created && today + created > movesDailyCap(env)) return json({ error: "The inbox is full for today. Your app will try again later." }, 429);

  // No IP is stored: only the boards, the name, the times and the keyed reporter hashes.
  await Promise.all(writes.map((w) => env.INBOX.put(w.key, JSON.stringify(w.record), { expirationTtl: KEEP_DAYS * 86_400 })));
  if (created) await env.INBOX.put(dayKey, String(today + created), { expirationTtl: 2 * 86_400 });
  return json({ accepted: writes.length, skipped });
}

async function pendingMoves(req: Request, env: Env): Promise<Response> {
  const cursor = new URL(req.url).searchParams.get("cursor") || undefined;
  const list = await env.INBOX.list({ prefix: "m:", limit: 500, cursor });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const r = parseMove(await env.INBOX.get(k.name));
      // A damaged record is left out; it expires on its own. The hashes never leave the Worker, only their count.
      return r && { id: k.name, name: r.name, from: r.from, to: r.to, reporters: r.reporters.length, first_at: r.first_at, last_at: r.last_at };
    }),
  );
  return json({ items: items.filter(Boolean), ...(list.list_complete ? {} : { cursor: list.cursor }) });
}

async function ackMoves(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = (Array.isArray(body?.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && x.startsWith("m:")).slice(0, 1000);
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
      if (req.method === "POST" && pathname === "/v1/moves") return await reportMoves(req, env);
      if (req.method === "GET" && pathname === "/v1/moves/pending") return authorized(req, env) ? await pendingMoves(req, env) : json({ error: "Unauthorized" }, 401);
      if (req.method === "POST" && pathname === "/v1/moves/ack") return authorized(req, env) ? await ackMoves(req, env) : json({ error: "Unauthorized" }, 401);
      if (req.method === "GET" && pathname === "/") return new Response("RawJobs contribution inbox. POST /v1/contributions\n", { headers: { "content-type": "text/plain" } });
      return json({ error: "Not found" }, 404);
    } catch (err) {
      // The details go to the Worker's logs, not to the caller.
      console.error(err);
      return json({ error: "Something went wrong; please try again later." }, 500);
    }
  },
};
