import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import type { CompanySuggestion, HiresIn } from "@rawjobs/core/suggest";
import { isPlaceholderBoard } from "@rawjobs/core/text";
import { useEffect, useMemo, useRef, useState } from "react";
import { keyOf, type CompanyRef } from "./companies";
import { canRunLocally } from "./data";
import { draftToConfig, type Draft } from "./setup";
import { load, save } from "./storage";

export type { CompanySuggestion };
export type Lookalike = CompanySuggestion & { similarity: number; like: string };

/** What `rawjobs companies suggest --json --stdin` answers (see packages/cli). */
export type CompanySuggestions = {
  hiringNow: CompanySuggestion[];
  worthWatching: CompanySuggestion[];
  notScannable: CompanySuggestion[];
  scanned: number;
  /** Each past employer, and the directory company it matched (left out when you watch it already). */
  pastEmployers: { name: string; company?: CompanyRef & { key: string; open_jobs: number | null; status?: string }; watched: boolean }[];
  /** Companies like a past employer, per employer. */
  lookalikes: { seed: string; in_directory: boolean; items: Lookalike[] }[];
  /** Best companies per industry you picked, and the next few after them (older answers have no `more`). */
  packs: { industry: string; items: CompanySuggestion[]; more?: CompanySuggestion[] }[];
  /** Companies in your industries in the directory, and how many we can check. */
  coverage: { in_industries: number; trackable: number };
  index_generated_at: string;
  error?: string;
};

export type SuggestState = { kind: "off" } | { kind: "loading"; previous?: CompanySuggestions } | { kind: "ready"; data: CompanySuggestions } | { kind: "error"; message: string };

/** The part of a suggestion the watchlist needs. */
export const refOf = (s: CompanySuggestion): CompanyRef => ({
  name: s.name,
  ats: s.ats,
  slug: s.slug,
  careers_url: s.careers_url,
  ...(s.region ? { region: s.region } : {}),
  ...(s.shard ? { shard: s.shard } : {}),
  ...(s.site ? { site: s.site } : {}),
});

/** How long the last real match took (ms), for the "Still matching" line: a measured estimate, never a guess. */
export const MATCH_MS_KEY = "rawjobs.suggestMatchMs";
/** An answer slower than this was worked out; a kept one comes back in milliseconds and says nothing about the next match. */
const WORKED_OUT_MS = 3000;
/** A profile edit waits this long for the next one before asking. */
const EDIT_PAUSE_MS = 600;

/** The last real match's length in seconds, rounded up to 5 ("about 20 seconds"); null before one was timed here. */
export function matchEstimate(): number | null {
  const ms = load<number | null>(MATCH_MS_KEY, null);
  return typeof ms === "number" && ms > 0 ? Math.ceil(ms / 5000) * 5 : null;
}

/**
 * Companies that fit the profile being edited, from the local API. The first ask of a visit goes out
 * at once (a kept answer then shows without a wait); a profile change asks again after a pause. Adding
 * or hiding a company doesn't refetch, the page filters those out itself.
 */
export function useCompanySuggestions(draft: Draft, enabled = true): SuggestState {
  const profile = useMemo(() => JSON.stringify(draftToConfig(draft).profile), [draft]);
  // Leave out what's saved in the config; companies added or hidden since are filtered on the page.
  const ready = enabled && canRunLocally && draft.include.length > 0;
  const [state, setState] = useState<SuggestState>({ kind: "off" });
  /** No request has gone out yet since the page opened (or since suggestions were switched back on). */
  const first = useRef(true);
  useEffect(() => {
    if (!ready) {
      first.current = true;
      return setState({ kind: "off" });
    }
    let live = true;
    setState((s) => ({ kind: "loading", previous: s.kind === "ready" ? s.data : s.kind === "loading" ? s.previous : undefined }));
    const t = setTimeout(
      () => {
        first.current = false;
        const started = Date.now();
        fetch("/api/companies/suggest", { method: "POST", body: JSON.stringify({ profile: JSON.parse(profile) }) })
          .then(async (r) => {
            const body = (await r.json()) as CompanySuggestions & { ok?: false; errors?: string };
            if (!live) return;
            if (!r.ok || body.ok === false) setState({ kind: "error", message: body.errors ?? `HTTP ${r.status}` });
            else if (body.error) setState({ kind: "error", message: body.error });
            else {
              const took = Date.now() - started;
              if (took >= WORKED_OUT_MS) save(MATCH_MS_KEY, took);
              setState({ kind: "ready", data: body });
            }
          })
          .catch((err: Error) => live && setState({ kind: "error", message: err.message }));
      },
      first.current ? 0 : EDIT_PAUSE_MS,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [profile, ready]);
  return state;
}

/**
 * How many companies a match checks (GET /api/companies/suggest/size), for "Matching 24,687 companies
 * to your profile". Null until it's known, or when the server can't say: the page then leaves the
 * number out rather than guess.
 */
export function useSuggestPoolSize(enabled: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !canRunLocally) return;
    let live = true;
    fetch("/api/companies/suggest/size", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ companies?: number | null }>) : null))
      .then((b) => live && typeof b?.companies === "number" && b.companies > 0 && setN(b.companies))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  return n;
}

/**
 * Suggestions without the companies you watch or hid since they were computed, and never a
 * sandbox/test board (the server leaves those out too; this covers older answers).
 */
export function visible<T extends CompanySuggestion>(list: readonly T[], skip: ReadonlySet<string>): T[] {
  return list.filter((s) => !skip.has(s.key) && !skip.has(keyOf(s)) && !isPlaceholderBoard(s.name));
}

/** Reasons that count roles ("3 open roles match you", "2 new this week", "4 similar roles nearby or remote"). */
const ROLE_COUNT = /^\d+ (open roles? (match|matches) you|new this week|similar roles? nearby or remote)$/;

/**
 * A suggestion's reasons as the Companies page shows them: about the company (your industry, your
 * topics, where it hires), never how many roles match you. Roles are read on the Radar.
 */
export const companyReasons = (reasons: readonly string[]) => reasons.filter((r) => !ROLE_COUNT.test(r));

/** Short names for the countries companies hire in most, so a card's line stays short. */
const SHORT_COUNTRY: Record<string, string> = { "United Arab Emirates": "UAE", "United Kingdom": "UK", "United States": "US" };

/** "Hires in UAE, UK", "Hires in UAE, remote", "Hires remote"; null when the index doesn't say. */
export function whereTheyHire(h: HiresIn | undefined): string | null {
  if (!h) return null;
  const places = h.countries.slice(0, 2).map((c) => SHORT_COUNTRY[c] ?? c);
  if (places.length) return `Hires in ${places.join(", ")}${h.remote ? ", remote" : ""}`;
  return h.remote ? "Hires remote" : null;
}

/** Suggestions that share one reason: shown once in the group's header, not on every card. */
export type SuggestionGroup = { id: string; title: string; reason: string; inside: boolean; items: CompanySuggestion[] };

const industryLabel = (id: string) => INDUSTRY_BY_ID.get(id)?.label ?? id;
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * Cards grouped by the reason they share, in the order of each group's best card: one group per
 * industry of yours ("Crypto & Web3 · Your industry, and your topics crypto and web3"), then one per
 * industry their job titles point to, then the rest. `lens` words the rest: in Hiring for you now
 * they all pass your title and place filters; otherwise the group says what they have in common.
 */
export function groupSuggestions(items: readonly CompanySuggestion[], lens: "hiring" | "watching"): SuggestionGroup[] {
  const groups = new Map<string, SuggestionGroup>();
  for (const s of items) {
    const ind = s.industries[0];
    const hires = s.hires_for[0];
    const id = ind ? `in:${ind}` : hires ? `for:${hires}` : "other";
    let g = groups.get(id);
    if (!g) {
      const title = ind ? industryLabel(ind) : hires ? industryLabel(hires) : "Other companies";
      const reason = ind ? "Your industry" : hires ? `Hires for ${industryLabel(hires)} roles` : "";
      g = { id, title, reason, inside: !!ind, items: [] };
      groups.set(id, g);
    }
    g.items.push(s);
  }
  return [...groups.values()].map((g) => {
    // Topics every card in the group has (each card's top 3), in the first card's order.
    const shared = g.items[0]!.topics.slice(0, 3).filter((t) => g.items.every((s) => s.topics.slice(0, 3).includes(t)));
    const topics = shared.length ? `your ${shared.length === 1 ? "topic" : "topics"} ${andList(shared)}` : "";
    if (g.id !== "other") return { ...g, reason: topics ? `${g.reason}, and ${topics}` : g.reason };
    return { ...g, reason: lens === "hiring" ? "Open roles that pass your title and place filters" : otherReason(g.items, topics) };
  });
}

/** What every company in Not hiring yet's catch-all group has in common. */
function otherReason(items: readonly CompanySuggestion[], topics: string): string {
  if (items.every((s) => s.near_misses > 0)) return "Your roles, nearby or remote";
  if (items.every((s) => s.elsewhere > 0)) return "Your roles, in other places";
  if (items.every((s) => s.in_your_places > 0)) return "Other roles, in your places";
  if (topics) return topics.charAt(0).toUpperCase() + topics.slice(1);
  return "Your roles, places or topics";
}
