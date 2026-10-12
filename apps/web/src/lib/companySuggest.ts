import type { CompanySuggestion } from "@rawjobs/core/suggest";
import { isPlaceholderBoard } from "@rawjobs/core/text";
import { useEffect, useMemo, useState } from "react";
import { keyOf, type CompanyRef } from "./companies";
import { canRunLocally } from "./data";
import { draftToConfig, type Draft } from "./setup";

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
  /** Best companies per industry you picked. */
  packs: { industry: string; items: CompanySuggestion[] }[];
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

/**
 * Companies that fit the profile being edited, from the local API. Asks again (after a pause) when
 * the profile changes; adding or hiding a company doesn't refetch, the page filters those out itself.
 */
export function useCompanySuggestions(draft: Draft, enabled = true): SuggestState {
  const profile = useMemo(() => JSON.stringify(draftToConfig(draft).profile), [draft]);
  // Leave out what's saved in the config; companies added or hidden since are filtered on the page.
  const ready = enabled && canRunLocally && draft.include.length > 0;
  const [state, setState] = useState<SuggestState>({ kind: "off" });
  useEffect(() => {
    if (!ready) return setState({ kind: "off" });
    let live = true;
    setState((s) => ({ kind: "loading", previous: s.kind === "ready" ? s.data : s.kind === "loading" ? s.previous : undefined }));
    const t = setTimeout(() => {
      fetch("/api/companies/suggest", { method: "POST", body: JSON.stringify({ profile: JSON.parse(profile) }) })
        .then(async (r) => {
          const body = (await r.json()) as CompanySuggestions & { ok?: false; errors?: string };
          if (!live) return;
          if (!r.ok || body.ok === false) setState({ kind: "error", message: body.errors ?? `HTTP ${r.status}` });
          else if (body.error) setState({ kind: "error", message: body.error });
          else setState({ kind: "ready", data: body });
        })
        .catch((err: Error) => live && setState({ kind: "error", message: err.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [profile, ready]);
  return state;
}

/**
 * Suggestions without the companies you watch or hid since they were computed, and never a
 * sandbox/test board (the server leaves those out too; this covers older answers).
 */
export function visible<T extends CompanySuggestion>(list: readonly T[], skip: ReadonlySet<string>): T[] {
  return list.filter((s) => !skip.has(s.key) && !skip.has(keyOf(s)) && !isPlaceholderBoard(s.name));
}
