import { companyLabel, displayName } from "@rawjobs/core/display-name";
import { ArrowRight, Check, CircleAlert, EyeOff, LoaderCircle, Radar, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { addCompanies, countCompanies, jobCompanyKey, keyOf, wantsAttention, type CompanyRef } from "../lib/companies";
import { useCompanySuggestions, type SuggestState } from "../lib/companySuggest";
import { coverageLine, initialCompaniesTab, type CompaniesTabId } from "../lib/companiesPage";
import type { DataMeta, Job } from "../lib/data";
import { canRunLocally, useDirectorySize } from "../lib/data";
import { useScanPrefs } from "../lib/scan";
import { draftToConfig, saveConfig, scanPlan, type CompanyRow, type Draft, type ScanPlan } from "../lib/setup";
import { load, save } from "../lib/storage";
import { AddByLink } from "./AddByLink";
import { MyCompanies, RecentRuns } from "./Companies";
import { CompanyFinder, useDirectory } from "./CompanyFinder";
import { ForYou } from "./companies/ForYou";
import { QuickAdd } from "./companies/QuickAdd";
import { packActions, Tray, useVisit } from "./companies/Tray";
import { TabList, TabPanel, useTabIds } from "./companies/Tabs";
import { EmptyState } from "./EmptyState";
import { toast } from "./Toast";
import { Button, Card, IconButton } from "./ui";

type Props = {
  /** A valid personal config exists (companies are saved into it). */
  configured: boolean;
  meta?: DataMeta;
  /** The Radar's jobs (yours, checked and from the directory): the names My companies links to. */
  jobs: Job[];
  draft: Draft;
  /** The saved setup is in the draft (until then it's a blank one, with 0 companies). */
  loaded: boolean;
  saved: Draft;
  update: (patch: Partial<Draft>) => void;
  onSaved: () => Promise<void>;
  onScan: () => void;
  scanning: boolean;
  toSetup: () => void;
  /** Company names hidden on the Radar (this browser). */
  hiddenNames: string[];
  onUnhideName: (name: string) => void;
};

const companiesKey = (d: Draft) => JSON.stringify([draftToConfig(d).companies, d.muted, d.pastEmployers]);

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * Save the Companies page's changes on their own, a moment after the last one. Only its fields
 * (companies, hidden, past employers) are written on top of the saved config, so unsaved Settings
 * edits in the shared draft stay unsaved. Never scans: the next scan picks the new list up.
 */
function useAutoSave(draft: Draft, saved: Draft, onSaved: () => Promise<void>, enabled: boolean) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const latest = useRef({ draft, saved, onSaved });
  latest.current = { draft, saved, onSaved };
  const busy = useRef(false);
  const again = useRef(false);
  const run = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setState({ kind: "saving" });
    try {
      do {
        again.current = false;
        const { draft: d, saved: s } = latest.current;
        const res = await saveConfig(draftToConfig({ ...s, companies: d.companies, muted: d.muted, pastEmployers: d.pastEmployers }));
        if (!res.ok) return setState({ kind: "error", message: res.errors });
        await latest.current.onSaved();
      } while (again.current);
      setState({ kind: "saved" });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    } finally {
      busy.current = false;
    }
  }, []);
  const pending = companiesKey(draft) !== companiesKey(saved);
  const key = companiesKey(draft);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` (the draft's companies) is the trigger: each change restarts the save delay
  useEffect(() => {
    if (!enabled || !pending) return;
    const t = setTimeout(() => void run(), 800);
    return () => clearTimeout(t);
  }, [key, pending, enabled, run]);
  return { state: pending && state.kind !== "error" && state.kind !== "saving" ? ({ kind: "saving" } as SaveState) : state, retry: run };
}

/** "Saving…", "Saved · used in your next scan", or what went wrong (with the reason and Retry, inline). */
function SaveStatus({ state, retry, onScan, scanning }: { state: SaveState; retry: () => void; onScan: () => void; scanning: boolean }) {
  if (!canRunLocally) return <span className="type-small text-muted">Changes stay in this browser.</span>;
  if (state.kind === "error")
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-small text-danger-text">
        <CircleAlert className="size-3.5 shrink-0" /> Couldn't save your changes{state.message ? `: ${state.message}` : "."}
        <button type="button" className="min-h-6 font-medium underline" onClick={retry}>
          Retry
        </button>
      </span>
    );
  if (state.kind === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 type-small text-muted">
        <LoaderCircle className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 type-small text-muted">
      <span className="inline-flex items-center gap-1">
        <Check className="size-3.5 text-success-text" /> {state.kind === "saved" ? "Saved. Used in your next scan." : "Changes save automatically."}
      </span>
      {state.kind === "saved" && (
        <button
          type="button"
          className="inline-flex min-h-6 items-center gap-1 font-medium text-ink underline underline-offset-2 hover:text-muted disabled:opacity-50"
          onClick={onScan}
          disabled={scanning}
        >
          <RefreshCw className="size-3" /> Scan now
        </button>
      )}
    </span>
  );
}

type Tab = CompaniesTabId;
const TAB_KEY = "rawjobs.companiesTab";

/** What each scan type covers (GET /api/scan/plan), asked again whenever the saved companies or industries change. */
function useScanPlan(saved: Draft, enabled: boolean): ScanPlan | null {
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const key = JSON.stringify([draftToConfig(saved).companies, saved.muted, saved.industries]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` (what the plan depends on) is the trigger
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void scanPlan().then((p) => {
      if (live) setPlan(p);
    });
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return enabled ? plan : null;
}

/**
 * Companies tab: one search and "Add by link" on top, then My companies (scanned every time, listed first
 * on the Radar), Suggestions (picked for your profile) and Browse all (the whole directory).
 */
export function CompaniesTab({ configured, meta, jobs, draft, loaded, saved, update, onSaved, onScan, scanning, toSetup, hiddenNames, onUnhideName }: Props) {
  const ids = useTabIds("companies");
  const linkPanelId = useId();
  // Chosen once the saved setup is in (a blank draft would always look like 0 companies). Opening on
  // Suggestions at 0 companies doesn't overwrite the remembered tab: only a click does.
  const initialTab = () => initialCompaniesTab({ attention: wantsAttention(), stored: load<string | null>(TAB_KEY, null), companies: draft.companies.length });
  const [chosen, setTabState] = useState<Tab | null>(() => (wantsAttention() ? "mine" : loaded ? initialTab() : null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the saved setup arrives
  useEffect(() => {
    if (loaded) setTabState((t) => t ?? initialTab());
  }, [loaded]);
  const tab = chosen;
  const setTab = (t: Tab) => {
    setTabState(t);
    save(TAB_KEY, t);
  };
  /** Bumped each time a "failing" link is followed: My companies switches to Needs attention. */
  const [attention, setAttention] = useState(() => (wantsAttention() ? 1 : 0));
  // biome-ignore lint/correctness/useExhaustiveDependencies: registers the hashchange listener once; setTab is a state setter
  useEffect(() => {
    const follow = () => {
      if (!wantsAttention()) return;
      setTab("mine");
      setAttention((n) => n + 1);
      // Back to "#companies", so following the same link again is a change the page hears.
      history.replaceState(null, "", "#companies");
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  /** The page's one search: its results show in Browse all. */
  const [q, setQ] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  /** Bumped after the directory updates (or to retry loading it), so search reloads it. */
  const [rev, setRev] = useState(0);
  const { directory, error: directoryError } = useDirectory(rev);
  /** The one directory size shown on this page (H9). */
  const directorySize = useDirectorySize(rev);
  const companyCount = useMemo(() => directorySize ?? (directory ? countCompanies(directory) : undefined), [directorySize, directory]);
  const autosave = useAutoSave(draft, saved, onSaved, configured && canRunLocally);
  const plan = useScanPlan(saved, configured && canRunLocally);
  const { scope } = useScanPrefs();
  /** "Right now: your 12 companies plus 175 in your 3 industries.": what your usual scan covers. */
  const coverage = plan && coverageLine({ plan, scope, industries: saved.industries.length, hasJobs: jobs.length > 0 });
  const savedKeys = useMemo(() => new Set(saved.companies.map(keyOf)), [saved.companies]);
  const watched = useMemo(() => new Set(draft.companies.map(keyOf)), [draft.companies]);
  const muted = useMemo(() => new Set(draft.muted), [draft.muted]);
  // From the saved profile (not half-made Settings edits), with the past employers edited here.
  const suggestFrom = useMemo(() => ({ ...saved, pastEmployers: draft.pastEmployers }), [saved, draft.pastEmployers]);
  // Retry = switch the request off for a moment and back on, which asks again.
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!retrying) return;
    const t = setTimeout(() => setRetrying(false), 50);
    return () => clearTimeout(t);
  }, [retrying]);
  const fetched = useCompanySuggestions(suggestFrom, configured && !retrying);
  const suggestions: SuggestState = retrying ? { kind: "loading" } : fetched;
  /** Fit scores from the suggestions, for ordering search results (never shown). */
  const fit = useMemo(() => {
    const m = new Map<string, number>();
    if (suggestions.kind !== "ready") return m;
    const d = suggestions.data;
    const all = [...d.hiringNow, ...d.worthWatching, ...d.notScannable, ...d.lookalikes.flatMap((r) => r.items), ...d.packs.flatMap((p) => p.items)];
    for (const s of all) m.set(s.key, Math.max(m.get(s.key) ?? 0, s.score));
    return m;
  }, [suggestions]);

  /** The names the Radar's jobs use per company key: My companies links each name to its jobs there. */
  const jobNames = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const j of jobs) {
      const names = m.get(jobCompanyKey(j)) ?? [];
      if (!names.includes(j.company)) m.set(jobCompanyKey(j), [...names, j.company]);
    }
    return m;
  }, [jobs]);

  // Undo needs the draft as it is when clicked, not when the toast was made.
  const latest = useRef(draft);
  latest.current = draft;
  /** This visit's Starter pack changes, for the tray (session memory, nothing saved). */
  const visit = useVisit();

  if (!configured) {
    return (
      <EmptyState
        title="Set up your radar first"
        actions={
          <Button variant="primary" onClick={toSetup}>
            Set up my radar <ArrowRight className="size-4" />
          </Button>
        }
      >
        Choose the roles and places you want, then the companies you'd love to work at. Those companies are scanned every time and their jobs come first.
      </EmptyState>
    );
  }

  /** Add companies not already yours (adding one also unhides it); returns the keys actually added. */
  const addMany = (list: CompanyRef[]): string[] => {
    const { patch, keys } = addCompanies(draft, list);
    if (patch) update(patch);
    return keys;
  };
  const removeMany = (keys: readonly string[]) => {
    const drop = new Set(keys);
    update({ companies: draft.companies.filter((r) => !drop.has(keyOf(r))) });
  };
  /** Put removed entries back as they were (Undo), skipping any that are back already. */
  const restore = (removed: readonly CompanyRow[]) => {
    const have = new Set(latest.current.companies.map(keyOf));
    update({ companies: [...latest.current.companies, ...removed.filter((r) => !have.has(keyOf(r)))] });
  };
  /** Remove right away, with Undo in a toast that puts the same entries back (H11). */
  const removeWithUndo = (keys: readonly string[]) => {
    const drop = new Set(keys);
    const removed = draft.companies.filter((r) => drop.has(keyOf(r)));
    if (!removed.length) return;
    removeMany(keys);
    const one = removed.length === 1 ? companyLabel(removed[0]!) : null;
    toast({
      message: one ? `Removed ${one} from My companies.` : `Removed ${removed.length} companies from My companies.`,
      actionLabel: "Undo",
      onAction: () => restore(removed),
    });
  };

  // Hidden companies: muted in your config (by key) and hidden on the Radar (by name), shown once each.
  const names = new Map((directory ?? []).map((c) => [c.key, c.name]));
  const mutedRows = draft.muted.map((key) => ({ key, name: names.get(key) }));
  const mutedNames = new Set(mutedRows.map((m) => m.name).filter(Boolean));
  const hidden = [...mutedRows, ...hiddenNames.filter((n) => !mutedNames.has(n)).map((name) => ({ key: undefined, name }))];

  const packs = packActions(visit, { companies: draft.companies, addMany, removeMany, restore });

  const openLink = () => {
    setLinkOpen(true);
    setTimeout(() => document.getElementById(linkPanelId)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  return (
    <div className="space-y-4">
      <QuickAdd
        q={q}
        onQ={(text) => {
          setQ(text);
          if (text.trim() && tab !== "browse") setTab("browse");
        }}
        count={companyCount}
        linkOpen={linkOpen}
        onToggleLink={() => setLinkOpen((v) => !v)}
        linkPanelId={linkPanelId}
        status={
          <span role="status">
            <SaveStatus state={autosave.state} retry={() => void autosave.retry()} onScan={onScan} scanning={scanning} />
          </span>
        }
      />

      {linkOpen && (
        <Card className="p-4 sm:p-5" id={linkPanelId}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="type-body font-semibold">Add by link</h2>
            <IconButton label="Close" onClick={() => setLinkOpen(false)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <AddByLink watched={watched} onAddMany={addMany} onRemove={(k) => removeMany([k])} autoFocus />
        </Card>
      )}

      {tab && (
        <TabList
          wrap
          tabs={[
            { id: "mine", label: "My companies", count: draft.companies.length },
            { id: "suggestions", label: "Suggestions" },
            { id: "browse", label: "Browse all" },
          ]}
          value={tab}
          onChange={setTab}
          label="Companies"
          ids={ids}
        />
      )}

      {tab === "mine" && (
        <TabPanel id="mine" ids={ids} className="space-y-4">
          <MyCompanies
            rows={draft.companies}
            savedKeys={savedKeys}
            meta={meta}
            jobNames={jobNames}
            onRemove={(k) => removeWithUndo([k])}
            onRemoveMany={removeWithUndo}
            onScan={onScan}
            scanning={scanning}
            attention={attention}
            empty={coverage ?? "You haven't added any companies yet."}
          />
          {draft.companies.length === 0 && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setTab("suggestions")}>
                See suggestions
              </Button>
              <Button onClick={() => setTab("browse")}>Browse all companies</Button>
            </div>
          )}

          {hidden.length > 0 && (
            <Card className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 type-body font-semibold">
                <EyeOff className="size-4 text-muted" /> Hidden companies <span className="tabular font-normal text-muted">({hidden.length})</span>
              </h2>
              <p className="mt-0.5 type-small text-muted">Their jobs don't show on your Radar, and scans skip them.</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {hidden.map((h) => (
                  <li key={h.key ?? h.name} className="inline-flex h-8 items-center gap-2 rounded-md border border-line pl-2.5 pr-1.5 type-small">
                    <span className="font-medium">{h.name ? displayName(h.name) : h.key}</span>
                    <button
                      type="button"
                      className="min-h-6 type-label text-ink underline underline-offset-2 hover:text-muted"
                      aria-label={`Show ${h.name ? displayName(h.name) : h.key} again`}
                      onClick={() => {
                        if (h.key) update({ muted: draft.muted.filter((k) => k !== h.key) });
                        if (h.name) onUnhideName(h.name);
                      }}
                    >
                      Show again
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {meta && <RecentRuns meta={meta} />}
        </TabPanel>
      )}

      {tab === "suggestions" && (
        <TabPanel id="suggestions" ids={ids} className="space-y-4">
          {coverage && <CoverageLine text={coverage} />}
          <ForYou
            state={suggestions}
            watched={watched}
            muted={muted}
            pastEmployers={draft.pastEmployers}
            onPastEmployers={(pastEmployers) => update({ pastEmployers })}
            onAddMany={addMany}
            onRemoveMany={removeMany}
            onMute={(key) => update({ muted: [...new Set([...draft.muted, key])], companies: draft.companies.filter((r) => keyOf(r) !== key) })}
            onUnmute={(key) => update({ muted: draft.muted.filter((k) => k !== key) })}
            onRetry={() => setRetrying(true)}
            industries={saved.industries.length}
            packActions={packs}
            offHint="Suggestions aren't available in this version of the app. Search the directory or add a company by link instead."
          />
        </TabPanel>
      )}

      {tab === "browse" && (
        <TabPanel id="browse" ids={ids}>
          <CompanyFinder
            watched={watched}
            directory={directory}
            directoryError={directoryError}
            onAddMany={addMany}
            onRemove={(k) => removeMany([k])}
            onDirectoryUpdated={() => setRev((r) => r + 1)}
            fit={fit}
            industries={draft.industries}
            q={q}
            onAddByLink={openLink}
            companyCount={companyCount}
          />
        </TabPanel>
      )}

      <Tray visit={visit.visit} watched={watched} actions={packs} />
      {/* One polite line that reads out each pack change and Undo, always there so none is missed. */}
      <p role="status" aria-live="polite" className="sr-only">
        {visit.said}
      </p>
    </div>
  );
}

/** One line on what your usual scan covers; read out again when it changes (as companies are added). */
function CoverageLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 type-small text-ink" aria-live="polite">
      <Radar className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> {text}
    </p>
  );
}
