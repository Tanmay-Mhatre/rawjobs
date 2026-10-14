import type { HttpClient } from "./http";
import { HttpError } from "./http";

/**
 * robots.txt for the connectors that need it: fetched once per host and kept for a day. Reads the
 * group for our own product token ("rawjobs") or, failing that, "*", and matches paths the usual way:
 * the longest matching rule wins, Allow wins a tie, `*` matches anything and `$` anchors the end.
 * A missing robots.txt (4xx) allows everything; so does one we can't reach, so a flaky host only
 * fails at the real request. Some sites serve robots.txt as an HTML page: its text is read out.
 */
export type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay?: number };

const AGENT = "rawjobs";
const TTL_MS = 24 * 3_600_000;
const cache = new Map<string, { at: number; rules: Promise<RobotsRules> }>();

/** For tests. */
export function clearRobotsCache(): void {
  cache.clear();
}

/** The rules that apply to us in a robots.txt body. */
export function parseRobots(body: string): RobotsRules {
  const text = /<html[\s>]|<body[\s>]/i.test(body)
    ? body
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>|<\/(p|div|pre|li)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
    : body;
  type Group = { agents: string[]; rules: RobotsRules };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: { allow: [], disallow: [] } }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.rules.allow.push(value);
    else if (key === "disallow" && value) current.rules.disallow.push(value);
    else if (key === "crawl-delay" && Number.isFinite(Number(value))) current.rules.crawlDelay = Number(value);
  }
  const pick = (test: (a: string) => boolean) => groups.filter((g) => g.agents.some(test));
  const ours = pick((a) => a.replace(/\/.*$/, "").trim() === AGENT);
  const chosen = ours.length ? ours : pick((a) => a === "*");
  return {
    allow: chosen.flatMap((g) => g.rules.allow),
    disallow: chosen.flatMap((g) => g.rules.disallow),
    crawlDelay: chosen.find((g) => g.rules.crawlDelay !== undefined)?.rules.crawlDelay,
  };
}

/** How much of `path` a rule covers (its length), or -1 when it doesn't match. */
function matchLength(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(
    `^${body
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}${anchored ? "$" : ""}`,
  );
  return re.test(path) ? body.length : -1;
}

/** Whether these rules let us fetch `path` (path + query). */
export function robotsAllowsPath(rules: RobotsRules, path: string): boolean {
  const best = (list: string[]) => Math.max(-1, ...list.map((r) => matchLength(r, path)));
  const d = best(rules.disallow);
  return d < 0 || best(rules.allow) >= d;
}

async function load(http: HttpClient, origin: string): Promise<RobotsRules> {
  try {
    return parseRobots(await http.getText(`${origin}/robots.txt`));
  } catch (err) {
    // No robots.txt (4xx) or no answer: nothing is disallowed.
    if (err instanceof HttpError) return { allow: [], disallow: [] };
    throw err;
  }
}

/** The robots rules for a URL's host, fetched at most once a day. */
export function robotsFor(http: HttpClient, url: string): Promise<RobotsRules> {
  const origin = new URL(url).origin;
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rules;
  const rules = load(http, origin);
  cache.set(origin, { at: Date.now(), rules });
  return rules;
}

/** Whether robots.txt lets us fetch `url`. */
export async function robotsAllows(http: HttpClient, url: string): Promise<boolean> {
  const u = new URL(url);
  return robotsAllowsPath(await robotsFor(http, url), `${u.pathname}${u.search}`);
}

/** Throws when robots.txt asks us not to fetch `url`. */
export async function assertRobotsAllow(http: HttpClient, url: string): Promise<void> {
  if (!(await robotsAllows(http, url))) throw new Error(`robots.txt asks us not to read ${new URL(url).host}${new URL(url).pathname}`);
}
