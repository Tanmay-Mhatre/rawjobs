/**
 * Company-owned evidence for a moved careers page (docs/plans/auto-accept-moves.md). Only the company
 * itself can point at its new board, so evidence comes from one place: the company-hosted careers page
 * the directory already had for the old board (its `careers_url` on a host that isn't a hiring
 * system), and that same host's homepage. Never a sibling subdomain, never anything a reporter or a
 * board owner typed, never a name match.
 *
 *   S1  the page links exactly one hiring-system board, and it's the candidate (URLs are parsed and run
 *       through the board detectors, so "acme" never matches "acme-fake");
 *   S2  the old careers URL now redirects to the candidate, every hop before the last on the trusted host.
 */
import { Resolver } from "node:dns/promises";
import { careersUrl, companyKey, detectCompany } from "@rawjobs/core";
import { boardKey, type DirRow, type MoveBoard, parseBoardKey } from "./moves";
import { allowedUrl, type SafeGet } from "./safe-fetch";

/** Hosts a hiring system provisions per customer, under contract: an NXDOMAIN there means the tenant is gone. */
export const VENDOR_HOST_SUFFIXES = [".taleo.net", ".myworkdayjobs.com", ".oraclecloud.com", ".successfactors.com", ".successfactors.eu"];

/** The same board: same directory key, and the same career site when both name one (Oracle's key leaves it out). */
export function sameBoard(a: MoveBoard, b: MoveBoard): boolean {
  if (companyKey(a) !== companyKey(b)) return false;
  return !a.site || !b.site || a.site.toLowerCase() === b.site.toLowerCase();
}

const boardOf = (url: string): MoveBoard | null => {
  const d = detectCompany(url);
  if (!d) return null;
  return { ats: d.ats, slug: d.slug, ...(d.region && d.region !== "global" ? { region: d.region } : {}), ...(d.shard ? { shard: d.shard } : {}), ...(d.site ? { site: d.site } : {}) };
};

/** The company-hosted careers page to trust for a directory row: https, port 443, not a hiring-system host. */
export function trustedUrlOf(row: Pick<DirRow, "careers_url"> | undefined): string | null {
  const raw = row?.careers_url;
  if (!raw) return null;
  const u = allowedUrl(raw);
  if (!u || boardOf(u.href)) return null;
  return u.href;
}

/** Undo the escapes pages hide URLs behind: JSON (`\/`, `/`), HTML entities, percent-encoded slashes. */
export function unescapePage(body: string): string {
  return body
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&#x2[fF];|&#47;|&sol;/g, "/")
    .replace(/&#x3[aA];|&#58;|&colon;/g, ":")
    .replace(/&amp;/g, "&")
    .replace(/%2[fF]/g, "/")
    .replace(/%3[aA]/g, ":");
}

/** Every hiring-system board a page points at (links, script and iframe sources, text), one per board. */
export function boardsInPage(body: string): MoveBoard[] {
  const text = unescapePage(body);
  const out: MoveBoard[] = [];
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>\\`)]*)?/gi)) {
    const raw = m[0].startsWith("//") ? `https:${m[0]}` : m[0];
    const b = boardOf(raw);
    if (b && !out.some((x) => sameBoard(x, b))) out.push(b);
  }
  return out;
}

export type PageEvidence =
  | { status: "unknown"; url: string; reason: string }
  | {
      status: "ok";
      url: string;
      /** S2: where the old careers URL redirects off the trusted host, when that's a board. */
      redirect?: MoveBoard;
      /** Off the trusted host, but not to a board (or not by the rule): no S2, no S1. */
      offHost?: string;
      /** Boards on the trusted page and the same host's homepage. */
      boards: MoveBoard[];
    };

/**
 * Read the trusted page (and the homepage on the same host). A fetch that fails, is refused by
 * robots.txt or is blocked gives "unknown": never a pass, and never a reason to revert.
 */
export async function readCompanyPage(trustedUrl: string, get: SafeGet): Promise<PageEvidence> {
  const host = new URL(trustedUrl).hostname;
  // A redirect off the trusted host is read from its Location only: the board's page isn't fetched.
  const page = await get(trustedUrl, { stayOn: host });
  if (page.kind === "error") return { status: "unknown", url: trustedUrl, reason: `${page.reason}${page.status ? ` ${page.status}` : ""}` };
  const finalHost = new URL(page.url).hostname;
  if (finalHost !== host) {
    // S2: every hop before the last on the trusted host, the last one off it and a board.
    const beforeLast = page.hops.slice(0, -1);
    const onHost = beforeLast.every((h) => new URL(h.url).hostname === host);
    const board = boardOf(page.url);
    return onHost && board ? { status: "ok", url: trustedUrl, redirect: board, boards: [] } : { status: "ok", url: trustedUrl, offHost: page.url.slice(0, 200), boards: [] };
  }
  const boards = boardsInPage(page.body);
  const home = `https://${host}/`;
  if (new URL(page.url).pathname !== "/") {
    const h = await get(home, { stayOn: host });
    if (h.kind === "ok" && new URL(h.url).hostname === host) for (const b of boardsInPage(h.body)) if (!boards.some((x) => sameBoard(x, b))) boards.push(b);
  }
  return { status: "ok", url: trustedUrl, boards };
}

/**
 * What the company page says about one candidate:
 *   match    S1 (the only board on the page) or S2 (the redirect) is the candidate;
 *   other    the page points at exactly one board, and it isn't the candidate (a contradiction);
 *   several  more than one board on the page (group or subsidiary sites): a person decides;
 *   none     no board at all, or off the host to something that isn't a board;
 *   unknown  the page couldn't be read.
 */
export type Finding = "match" | "other" | "several" | "none" | "unknown";
export function judge(ev: PageEvidence, to: MoveBoard): { finding: Finding; kind?: "S1" | "S2"; points?: MoveBoard } {
  if (ev.status === "unknown") return { finding: "unknown" };
  if (ev.redirect) return sameBoard(ev.redirect, to) ? { finding: "match", kind: "S2", points: ev.redirect } : { finding: "other", points: ev.redirect };
  if (ev.boards.length > 1) return { finding: "several" };
  const only = ev.boards[0];
  if (!only) return { finding: "none" };
  return sameBoard(only, to) ? { finding: "match", kind: "S1", points: only } : { finding: "other", points: only };
}

// ---- baselines: which boards a trusted page linked before anyone reported a move ----

/** `at`: the latest snapshot; `first_at`: the first one ever (kept on refresh, for the domain-age check). */
export type Baseline = { url: string; boards: string[]; at: string; first_at?: string };
export type BaselinesFile = { version: 1; pages: Record<string, Baseline> };
export const emptyBaselines = (): BaselinesFile => ({ version: 1, pages: {} });
/** A page is snapshot again after this long (never while its board has a pending report). */
export const BASELINE_REFRESH_DAYS = 30;

/** Stored as board keys (`ats:slug|shard|site`), so the career site is kept. */
export const baselineBoards = (bs: readonly MoveBoard[]): string[] => bs.map(boardKey);

/**
 * The old board was on the company page before the report, and now only the candidate is: a swap the
 * company made. Needs a snapshot taken before the move was first reported.
 */
export function baselineSwap(base: Baseline | undefined, reportedAt: string, from: MoveBoard, to: MoveBoard, ev: PageEvidence): boolean {
  if (!base || base.at >= reportedAt || ev.status !== "ok") return false;
  const before = base.boards.map(parseBoardKey).filter((b): b is MoveBoard => !!b);
  const linkedFrom = before.some((b) => sameBoard(b, from));
  const linkedTo = before.some((b) => sameBoard(b, to));
  return linkedFrom && !linkedTo && judge(ev, to).finding === "match";
}

// ---- the old board's host is gone (vendor-provisioned hosts only) ----

/** The old board's host when a hiring system provisions it per customer (Taleo, Workday, Oracle, SuccessFactors). */
export function vendorHostOf(b: MoveBoard): string | null {
  const url = careersUrl(b as never);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VENDOR_HOST_SUFFIXES.some((s) => host.endsWith(s)) ? host : null;
  } catch {
    return null;
  }
}

/** Public resolvers, asked directly: the machine's own resolver may refuse, rewrite or hide NXDOMAIN. */
const publicResolver = () => {
  const r = new Resolver({ timeout: 5_000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return (host: string) => r.resolve4(host);
};

/**
 * true: the name doesn't exist (NXDOMAIN, which c-ares reports as ENOTFOUND). false: it resolves, or
 * the answer was something else (no A record, a timeout, a refusal): never proof.
 */
export async function isNxdomain(host: string, resolve: (h: string) => Promise<unknown> = publicResolver()): Promise<boolean> {
  try {
    await resolve(host);
    return false;
  } catch (err) {
    return (err as { code?: string }).code === "ENOTFOUND";
  }
}

// ---- RDAP: when the company's domain was registered ----

const RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

/**
 * The registration date of the trusted host's registrable domain, from RDAP (IANA bootstrap). Tries
 * the shortest name first (mashreq.com before careers.mashreq.com); a 404 means "not a registered
 * name", so it tries one label more. Unknown when the TLD has no RDAP service (.ae, .io, .co today).
 */
export function rdapLookup(get: SafeGet) {
  let services: Promise<[string[], string[]][] | null> | null = null;
  const bootstrap = () =>
    (services ??= (async () => {
      const r = await get(RDAP_BOOTSTRAP);
      if (r.kind !== "ok") return null;
      try {
        return (JSON.parse(r.body) as { services: [string[], string[]][] }).services;
      } catch {
        return null;
      }
    })());
  return async function registered(host: string): Promise<{ date: string } | { unknown: string }> {
    const labels = host.toLowerCase().split(".");
    const tld = labels[labels.length - 1]!;
    const list = await bootstrap();
    if (!list) return { unknown: "RDAP bootstrap not available" };
    const base = list.find(([tlds]) => tlds.includes(tld))?.[1].find((u) => u.startsWith("https://"));
    if (!base) return { unknown: `no RDAP service for .${tld}` };
    for (let n = 2; n <= Math.min(labels.length, 4); n++) {
      const domain = labels.slice(-n).join(".");
      const r = await get(`${base.replace(/\/?$/, "/")}domain/${domain}`);
      if (r.kind === "error") {
        if (r.status === 404) continue;
        return { unknown: `RDAP ${r.reason}` };
      }
      try {
        const events = (JSON.parse(r.body) as { events?: { eventAction?: string; eventDate?: string }[] }).events ?? [];
        const reg = events.find((e) => e.eventAction === "registration")?.eventDate;
        return reg && !Number.isNaN(Date.parse(reg)) ? { date: new Date(reg).toISOString() } : { unknown: "no registration date" };
      } catch {
        return { unknown: "RDAP answer unreadable" };
      }
    }
    return { unknown: "no registered name found" };
  };
}
export type RdapLookup = ReturnType<typeof rdapLookup>;

// ---- the verdict ----

/** A domain must be registered at least this long, and before the first snapshot of its page. */
export const MIN_DOMAIN_AGE_DAYS = 365;

/**
 * What the evidence allows for one candidate that passes every gate:
 *   auto    the company page points at it (S1 or S2), the old board is proven gone or the page swapped
 *           from it to this one, the domain is old (RDAP) and not newer than our first look at the page,
 *           and it isn't a pack company (those always get a person: the most-followed boards);
 *   fast    the company page points at it, but something above is missing: a person approves;
 *   manual  no usable company evidence.
 */
export function decide(input: {
  finding: Finding;
  gone: "proven" | "not_proven" | "waiting" | "live" | "unchecked";
  baselineSwap: boolean;
  registered: { date: string } | { unknown: string } | null;
  /** When we first looked at the page (the baseline), if ever. */
  firstSeen?: string;
  pack: boolean;
  now: Date;
}): { verdict: "auto" | "fast" | "manual"; reasons: string[] } {
  if (input.finding !== "match") return { verdict: "manual", reasons: [`company page: ${input.finding}`] };
  const reasons: string[] = [];
  if (input.gone !== "proven" && !input.baselineSwap) reasons.push("old board not proven gone, and no before/after swap on the company page");
  const reg = input.registered;
  if (!reg) reasons.push("domain age not checked");
  else if ("unknown" in reg) reasons.push(`domain age unknown (${reg.unknown})`);
  else {
    if (input.now.getTime() - Date.parse(reg.date) < MIN_DOMAIN_AGE_DAYS * 86_400_000) reasons.push("domain registered under a year ago");
    if (input.firstSeen && reg.date > input.firstSeen) reasons.push("domain registered after we first saw the page (re-registered?)");
  }
  if (input.pack) reasons.push("pack company: always approved by a person");
  return { verdict: reasons.length ? "fast" : "auto", reasons };
}
