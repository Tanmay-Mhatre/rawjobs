import { useCallback, useEffect, useState } from "react";
import { ROLE_FAMILIES } from "@rawjobs/core/catalog/roles";
import { careersUrl, companyKey, connectors, detectCompany } from "@rawjobs/core/detect";
import type { AiProfile } from "@rawjobs/core/resume-parse";
import type { CompanyCheck, RunEvent, SaveResult, ScanPlan, ScanScope, SetupStatus } from "@rawjobs/core/protocol";
import type { AtsType, Config } from "@rawjobs/core/schema";

export type { CompanyCheck, RunEvent, SaveResult, ScanPlan, ScanScope, SetupStatus };
import { canRunLocally } from "./data";

// ---------- API (dev server only, see apps/web/vite.config.ts) ----------

/** null = no local API (hosted build): setup is done by editing the config file. */
export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (!canRunLocally) return setStatus(null);
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      setStatus(res.ok ? ((await res.json()) as SetupStatus) : null);
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}

export async function saveConfig(config: Config): Promise<SaveResult> {
  const res = await fetch("/api/setup/config", { method: "POST", body: JSON.stringify(config) });
  return (await res.json()) as SaveResult;
}

/** Start setup over: the config is moved to a backup file; resume and Telegram alerts stay. */
export async function resetSetup(): Promise<{ ok: true; backup: string | null } | { ok: false; errors: string }> {
  try {
    const res = await fetch("/api/setup/reset", { method: "POST" });
    return (await res.json()) as { ok: true; backup: string | null } | { ok: false; errors: string };
  } catch (err) {
    return { ok: false, errors: (err as Error).message };
  }
}

/** Live check through the local API; offline (hosted) falls back to URL detection only. */
export async function checkCompanies(urls: string[]): Promise<CompanyCheck[]> {
  if (!canRunLocally) {
    return urls.map((input): CompanyCheck => {
      const d = detectCompany(input);
      if (!d) return { input, status: "unknown", error: "Not a careers site RawJobs can read yet." };
      const { supported, ...ref } = d;
      return { input, ...ref, key: companyKey(ref), careers_url: careersUrl(ref) || input, name_source: "slug", status: supported ? "live" : "soon" };
    });
  }
  const res = await fetch("/api/setup/check", { method: "POST", body: JSON.stringify({ urls }) });
  if (!res.ok) throw new Error(((await res.json()) as { errors?: string }).errors ?? `HTTP ${res.status}`);
  return (await res.json()) as CompanyCheck[];
}

export async function scanPlan(): Promise<ScanPlan | null> {
  try {
    const res = await fetch("/api/scan/plan", { cache: "no-store" });
    return res.ok ? ((await res.json()) as ScanPlan) : null;
  } catch {
    return null;
  }
}

/** Ask the running scan to send a Telegram message when it finishes. */
export async function notifyWhenDone(): Promise<boolean> {
  try {
    const res = await fetch("/api/run/notify", { method: "POST" });
    return ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/** Ask the running scan to stop after the companies in progress; it can be resumed later. */
export async function stopScan(): Promise<void> {
  await fetch("/api/run/stop", { method: "POST" }).catch(() => {});
}

/** "Check now": fetch just these directory companies ("ats:slug") on this machine. */
export async function checkNow(keys: string[]): Promise<Extract<RunEvent, { type: "done" | "error" }>> {
  try {
    const res = await fetch("/api/check", { method: "POST", body: JSON.stringify({ keys }) });
    return (await res.json()) as Extract<RunEvent, { type: "done" | "error" }>;
  } catch (err) {
    return { type: "error", message: (err as Error).message };
  }
}

/** Run a scan on this machine, reporting progress as it streams in. */
export async function runScan(onEvent: (e: RunEvent) => void, opts: { scope?: ScanScope; fresh?: boolean } = {}): Promise<void> {
  const res = await fetch("/api/run", { method: "POST", body: JSON.stringify({ scope: opts.scope ?? "mine", fresh: opts.fresh }) });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Couldn't start the scan (HTTP ${res.status}).` });
    return;
  }
  await readEvents(res.body, onEvent);
}

/**
 * Follow the scan the server is already running (started before this page was opened or reloaded),
 * from its first event. False when no scan is running; `started` gets the scope before any event.
 */
export async function followScan(started: (scope: ScanScope) => void, onEvent: (e: RunEvent) => void): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch("/api/run", { cache: "no-store" });
  } catch {
    return false;
  }
  if (res.status !== 200 || !res.body) return false;
  started(res.headers.get("x-rawjobs-scope") === "all" ? "all" : "mine");
  await readEvents(res.body, onEvent);
  return true;
}

async function readEvents(body: ReadableStream<BufferSource>, onEvent: (e: RunEvent) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as RunEvent);
      } catch {
        // ignore stray output
      }
    }
  }
}

// ---------- the wizard's working copy ----------

/** A company on the watchlist. */
export type CompanyRow = {
  id: string;
  /** The careers link (or "ats: slug" for config lines without one). */
  input: string;
  /** saved: we can scan it now · soon: its hiring system is coming soon; kept until then. */
  state: "saved" | "soon";
  name: string;
  ats?: AtsType;
  slug?: string;
  region?: "global" | "eu";
  shard?: string;
  site?: string;
};

export type Draft = {
  name: string;
  include: string[];
  exclude: string[];
  seniority: string[];
  places: string[];
  /** Office jobs you'll take (Work style). None = remote only, so places are ignored. */
  office: ("onsite" | "hybrid")[];
  remote: boolean;
  remoteOk: string[];
  remoteExclude: string[];
  keywords: Record<string, number>;
  /** Industry ids (Settings; suggested from your resume). */
  industries: string[];
  /** Companies you've worked at (from your resume, confirmed by you): seeds "companies like them". */
  pastEmployers: string[];
  /** Dealbreakers (Settings): lowest base pay, as typed. Saved only with an amount and a 3-letter currency. */
  salaryFloor?: { amount: number; currency: string; period: "year" | "month" };
  /** Countries you can work in without a visa sponsor. Empty = not checked. */
  workAuthorization: string[];
  /** Work you won't do ("frontend", "credit risk"). */
  avoid: string[];
  companies: CompanyRow[];
  minScore: number;
  alerts: Config["alerts"];
  /** Shared company directory: auto-update, share companies you add. */
  directory: Config["directory"];
  /** Companies never shown ("ats:slug" keys). */
  muted: string[];
  /** Jobs beyond your companies: how many more companies each scan checks live. */
  discovery: Config["discovery"];
  /** Furthest wizard step visited, so "Continue setup" can resume there. */
  furthestStep: number;
  /** Profile block from the AI master-resume answer, used for suggestions. */
  aiProfile?: AiProfile;
  /** Chosen job family id (Roles step); its titles are the toggle list. */
  family?: string;
};

let seq = 0;
export const rowId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyDraft(): Draft {
  return {
    name: "My job search",
    include: [],
    exclude: [],
    seniority: [],
    places: [],
    office: ["onsite", "hybrid"],
    remote: false,
    remoteOk: [],
    remoteExclude: [],
    keywords: {},
    industries: [],
    pastEmployers: [],
    workAuthorization: [],
    avoid: [],
    companies: [],
    minScore: 70,
    alerts: { telegram: false, email: false, only_new: true },
    directory: { auto_update: true, share_additions: true },
    muted: [],
    discovery: { check_per_scan: 30 },
    furthestStep: 0,
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Build a draft from a valid config, or best-effort from a broken one. */
export function draftFromConfig(input: unknown): Draft {
  const c = obj(input);
  const p = obj(c.profile);
  const t = obj(p.titles);
  const l = obj(p.locations);
  const d = emptyDraft();
  const remoteOk = strings(l.remote_ok);
  const keywords: Record<string, number> = {};
  for (const [k, w] of Object.entries(obj(p.keywords))) {
    if (typeof w === "number") keywords[k] = Math.min(5, Math.max(1, Math.round(w)));
  }
  const companies: CompanyRow[] = (Array.isArray(c.companies) ? c.companies : []).flatMap((x): CompanyRow[] => {
    const co = obj(x);
    if (typeof co.slug !== "string" || typeof co.ats !== "string") return [];
    return [
      {
        id: rowId(),
        input: typeof co.careers_url === "string" ? co.careers_url : `${co.ats}: ${co.slug}`,
        // Saved companies on ATSs we can't fetch yet stay "coming soon".
        state: connectors[co.ats as AtsType] ? "saved" : "soon",
        name: typeof co.name === "string" ? co.name : co.slug,
        ats: co.ats as AtsType,
        slug: co.slug,
        region: co.region as CompanyRow["region"],
        shard: typeof co.shard === "string" ? co.shard : undefined,
        site: typeof co.site === "string" ? co.site : undefined,
      },
    ];
  });
  const alerts = obj(c.alerts);
  const directory = obj(c.directory);
  const discovery = obj(c.discovery);
  return {
    name: typeof p.name === "string" ? p.name : d.name,
    include: strings(t.include),
    exclude: strings(t.exclude),
    seniority: strings(p.seniority_boost),
    places: strings(l.include),
    office: officeFromConfig(l.workplace, strings(l.include).length > 0, remoteOk.length > 0),
    remote: remoteOk.length > 0,
    remoteOk,
    remoteExclude: strings(l.remote_exclude),
    keywords,
    industries: strings(p.industries),
    pastEmployers: strings(p.past_employers),
    salaryFloor: salaryFloorFromConfig(p.salary_floor),
    workAuthorization: strings(p.work_authorization),
    avoid: strings(p.avoid),
    companies,
    minScore: typeof p.min_score === "number" ? p.min_score : d.minScore,
    alerts: {
      telegram: alerts.telegram === true,
      email: alerts.email === true,
      only_new: alerts.only_new !== false,
    },
    directory: { auto_update: directory.auto_update !== false, share_additions: directory.share_additions !== false },
    muted: strings(c.companies_muted).map((k) => k.toLowerCase()),
    discovery: {
      check_per_scan: typeof discovery.check_per_scan === "number" ? Math.min(100, Math.max(0, Math.round(discovery.check_per_scan))) : d.discovery.check_per_scan,
    },
    furthestStep: STEPS.length,
    family: inferFamily(strings(t.include)),
  };
}

/** A saved salary floor, or undefined when it's missing or not a number. */
function salaryFloorFromConfig(v: unknown): Draft["salaryFloor"] {
  const s = obj(v);
  if (typeof s.amount !== "number" || !(s.amount > 0)) return undefined;
  return { amount: s.amount, currency: typeof s.currency === "string" ? s.currency : "", period: s.period === "month" ? "month" : "year" };
}

/** The salary floor as the config takes it: a positive amount and a 3-letter currency, else none. */
export function salaryFloorToConfig(f: Draft["salaryFloor"]): Config["profile"]["salary_floor"] {
  const currency = f?.currency.trim().toUpperCase() ?? "";
  return f && f.amount > 0 && /^[A-Z]{3}$/.test(currency) ? { amount: f.amount, currency, period: f.period } : undefined;
}

/** Saved workplace list -> Work style: empty means both, unless the search is remote only (no places). */
function officeFromConfig(v: unknown, hasPlaces: boolean, hasRemote: boolean): Draft["office"] {
  const picked = strings(v).filter((x): x is "onsite" | "hybrid" => x === "onsite" || x === "hybrid");
  if (picked.length) return picked;
  return !hasPlaces && hasRemote ? [] : ["onsite", "hybrid"];
}

/** Office places that count: none when you only want remote work. */
export const officePlaces = (d: Pick<Draft, "office" | "places">) => (d.office.length ? d.places : []);

/** Rows that go into the config: trackable now, or coming soon with what they need (Workday needs its site). */
export function usableCompanies(d: Draft): CompanyRow[] {
  return d.companies.filter((r) => (r.state === "saved" || r.ats !== "workday" || (r.shard && r.site)) && r.ats && r.slug);
}

export function draftToConfig(d: Draft): Config {
  const seen = new Set<string>();
  const companies = usableCompanies(d)
    .filter((r) => {
      const k = `${r.ats}:${r.slug!.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      name: r.name.trim() || r.slug!,
      ats: r.ats!,
      slug: r.slug!,
      ...(r.region && r.region !== "global" ? { region: r.region } : {}),
      ...(r.shard ? { shard: r.shard } : {}),
      ...(r.site ? { site: r.site } : {}),
      ...(/^https?:\/\//i.test(r.input) ? { careers_url: r.input } : {}),
      enabled: true,
    }));
  return {
    profile: {
      name: d.name.trim() || "My job search",
      titles: { include: d.include, exclude: d.exclude },
      seniority_boost: d.seniority,
      locations: {
        include: officePlaces(d),
        remote_ok: d.remote ? d.remoteOk : [],
        remote_exclude: d.remote ? d.remoteExclude : [],
        // Both kinds is the default, written as "any".
        workplace: d.office.length === 1 ? d.office : [],
      },
      industries: d.industries,
      past_employers: d.pastEmployers,
      keywords: d.keywords,
      min_score: d.minScore,
      // Dealbreakers only when set, so a config without them reads exactly as before.
      ...(salaryFloorToConfig(d.salaryFloor) ? { salary_floor: salaryFloorToConfig(d.salaryFloor) } : {}),
      ...(d.workAuthorization?.length ? { work_authorization: d.workAuthorization } : {}),
      ...(d.avoid?.length ? { avoid: d.avoid } : {}),
    },
    companies,
    companies_muted: d.muted,
    discovery: d.discovery,
    alerts: d.alerts,
    directory: d.directory,
  };
}

// ---------- step rules (shared by the wizard and Settings) ----------

export const STEPS = [
  { id: 1, key: "resume", label: "Resume" },
  { id: 2, key: "roles", label: "Roles" },
  { id: 3, key: "locations", label: "Locations" },
  { id: 4, key: "industries", label: "Industries" },
  { id: 5, key: "review", label: "Review" },
] as const;

/** Step numbers by name, so screens never hard-code positions. */
export const STEP = { welcome: 0, resume: 1, roles: 2, locations: 3, industries: 4, review: 5 } as const;
export const STEP_COUNT = STEPS.length;

/** Why the user can't continue yet, or null. Resume and Industries are optional. */
export function stepBlocker(step: number, d: Draft): string | null {
  if (step === STEP.roles && d.include.length === 0) return "Pick at least one job title.";
  if (step === STEP.locations) {
    if (!d.office.length && !d.remote) return "Pick at least one work style.";
    if (!officePlaces(d).length && !(d.remote && d.remoteOk.length > 0)) return d.office.length ? "Add a place you can work from." : "Pick where you can work remotely.";
  }
  return null;
}

export type SetupProgress = {
  /** The user has answered anything yet. */
  started: boolean;
  /** Where "Continue setup" should go. */
  nextStep: number;
};

export function setupProgress(d: Draft, hasResume = false): SetupProgress {
  const furthest = d.furthestStep ?? 0;
  const started = furthest > 0 || hasResume || d.include.length > 0 || d.places.length > 0 || d.industries.length > 0 || Object.keys(d.keywords).length > 0;
  // Optional steps only send people back if they never got past them.
  if (furthest <= STEP.resume && !hasResume && d.include.length === 0) return { started, nextStep: STEP.resume };
  for (const s of [STEP.roles, STEP.locations]) if (stepBlocker(s, d)) return { started, nextStep: s };
  if (furthest <= STEP.industries && d.industries.length === 0) return { started, nextStep: STEP.industries };
  return { started, nextStep: STEP.review };
}

/** Steps that still block saving, for the Review screen. */
export function saveBlockers(d: Draft): { step: number; message: string }[] {
  const out = [STEP.roles, STEP.locations].flatMap((step): { step: number; message: string }[] => {
    const message = stepBlocker(step, d);
    return message ? [{ step, message }] : [];
  });
  // Only Settings sets a salary floor: an amount with no usable currency can't be saved.
  if (d.salaryFloor && d.salaryFloor.amount > 0 && !salaryFloorToConfig(d.salaryFloor)) out.push({ step: STEP.review, message: "Add the salary floor's currency as 3 letters, such as EUR." });
  return out;
}

/** The job family whose titles overlap most with these titles. */
export function inferFamily(titles: readonly string[]): string | undefined {
  let best: { id: string; n: number } | undefined;
  for (const f of ROLE_FAMILIES) {
    const n = titles.filter((t) => f.titles.includes(t)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: f.id, n };
  }
  return best?.id;
}

/**
 * The saved config changed under an open draft (e.g. the Companies page saved itself): take the new
 * saved value for every field the user hasn't touched, and keep their edits to the rest.
 */
export function rebaseDraft(draft: Draft, prevSaved: Draft, nextSaved: Draft): Draft {
  const out = { ...nextSaved } as Record<string, unknown>;
  const d = draft as unknown as Record<string, unknown>;
  const prev = prevSaved as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(draft), ...Object.keys(nextSaved)])) {
    if (JSON.stringify(d[k]) !== JSON.stringify(prev[k])) out[k] = d[k];
  }
  return out as unknown as Draft;
}
