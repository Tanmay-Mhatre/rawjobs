import { fitFeatures, learnedNudge, learnOrder } from "@rawjobs/core/learn";
import { useDeferredValue, useMemo, useState } from "react";
import { useOtherJobs, type DataMeta, type Job, type Profile } from "../../lib/data";
import {
  activeChips,
  applyFilters,
  facetCounts,
  foldCompanies,
  groupJobs,
  isNewJob,
  profilePlaces,
  roleCount,
  sortJobs,
  suggestRelax,
  type Ctx,
  type FeedRow,
  type Filters,
  type Sort,
} from "../../lib/filters";
import { postedOrSeen } from "../../lib/format";
import { knownCounter, useNetworkSummary } from "../../lib/network";
import { newCtx } from "../../lib/newSince";
import type { Prefs } from "../../lib/prefs";
import { load, save } from "../../lib/storage";
import { useMaxAge } from "../../lib/theme";
import type { UserState } from "../../lib/userState";
import { toast } from "../Toast";
import { useHourlyNow } from "./hooks";
import type { ChipId } from "./ViewsBar";

/** When Best match last started learning afresh (Reset); picks before it are left out. */
const LEARN_SINCE_KEY = "rawjobs.learnSince";
const NONE_OPEN: ReadonlySet<string> = new Set();
/** Your companies' freshest roles shown above the list in Best match. */
const STRIP = 3;

export type RadarListInput = {
  jobs: Job[];
  meta: DataMeta;
  user: UserState;
  prefs: Pick<Prefs, "hiddenCompanies" | "hideRules">;
  isYours: (j: Job) => boolean;
  /** Your saved profile now (or the one from the last scan). */
  profile: Profile;
  /** Stands for the parts of the profile the context uses (places, industries). */
  profileKey: string;
  /** Your profile's filters, after "Show everywhere". */
  base: Filters;
  filters: Filters;
  sort: Sort;
  /** The filter row or sheet is showing: only then are facet counts worked out (the costliest pass). */
  needFacets: boolean;
};

/**
 * Everything the Radar's list is worked out from its inputs: the context, the filtered and sorted roles,
 * your companies' strip, folded rows, counts for chips and views, facet counts and "remove a filter" hints.
 * The controls read `filters`; the list reads a deferred copy, so typing in search stays quick.
 */
export function useRadarList(i: RadarListInput) {
  const { jobs, meta, user, isYours, profile, profileKey, base, filters, sort } = i;
  const min = meta.profile.min_score;
  const other = useOtherJobs(filters.showFailed);
  const pool = useMemo(() => (filters.showFailed && other ? [...jobs, ...other] : jobs), [jobs, other, filters.showFailed]);

  // Industries per company: your companies (from the last scan), and any job that carries its company's.
  const industriesByCompany = useMemo(() => {
    const m = new Map(meta.companies.map((c) => [c.name, c.industries ?? []]));
    for (const j of jobs) if (j.industries?.length && !m.get(j.company)?.length) m.set(j.company, j.industries);
    return m;
  }, [meta.companies, jobs]);
  const hidden = useMemo(() => new Set(i.prefs.hiddenCompanies), [i.prefs.hiddenCompanies]);
  // "New to you": first found since your last visit (lib/newSince). On the first scan everything would be, so nothing is.
  const { firstScan, newSince } = useMemo(() => newCtx(meta.runs), [meta.runs]);
  // One clock for filters, tags and order, moved on every hour.
  const now = useHourlyNow();
  const maxAgeDays = useMaxAge();
  // Who you know at each company (your LinkedIn connections): one lookup per company name, never part of the score.
  const network = useNetworkSummary();
  const networkReady = !!network;
  const knownAt = useMemo(() => (network ? knownCounter(network.counts) : undefined), [network]);
  const hideRules = i.prefs.hideRules;
  // biome-ignore lint/correctness/useExhaustiveDependencies: profileKey stands for the parts of the profile the context uses
  const ctx: Ctx = useMemo(() => {
    const places = profilePlaces(profile);
    return {
      firstScan,
      newSince,
      now,
      maxAgeDays,
      user,
      min,
      industriesOf: (c: string) => industriesByCompany.get(c) ?? [],
      hiddenCompanies: hidden,
      hideRules,
      isYours,
      knownAt,
      mine: { countries: new Set([...places.countries, ...(places.remote ? ["Remote"] : [])]), locations: new Set(places.locations), industries: new Set(profile.industries) },
    };
  }, [user, min, industriesByCompany, hidden, hideRules, profileKey, isYours, firstScan, newSince, now, maxAgeDays, knownAt]);

  // One list, in the order you picked: your companies are starred and nudged up in Best match, never pinned.
  // Best match learns from what you save, apply to and mark Not interested (since your last Reset), on this computer only.
  const [learnSince, setLearnSince] = useState(() => load<string>(LEARN_SINCE_KEY, ""));
  const learned = useMemo(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    // Each choice keeps the job's parts from when you made it (snapshot.fit), so it counts after the posting closes.
    const picks = Object.entries(user).flatMap(([id, e]) => {
      if (!e.status || e.updatedAt <= learnSince) return [];
      const job = byId.get(id);
      const features = e.snapshot.fit ?? (job ? fitFeatures(job.why) : undefined);
      return features ? [{ features, status: e.status, reason: e.reason, at: e.updatedAt, score: job?.score ?? e.snapshot.score }] : [];
    });
    return learnOrder(picks);
  }, [jobs, user, learnSince]);
  const nudge = useMemo(() => (learned ? (j: Job) => learnedNudge(learned, j.why) : undefined), [learned]);
  const resetLearned = () => {
    const was = learnSince;
    const set = (v: string) => {
      save(LEARN_SINCE_KEY, v);
      setLearnSince(v);
    };
    set(new Date().toISOString());
    toast({ message: "Best match order reset: it learns again from your next picks", actionLabel: "Undo", onAction: () => set(was) });
  };

  // The controls read `filters`; the list reads this deferred copy. `filters` is state, so the copy is stable and
  // the list's work runs once per change, not once urgent and once deferred.
  const listFilters = useDeferredValue(filters);
  const currency = profile.salary_floor?.currency;
  const visible = useMemo(
    () => sortJobs(applyFilters(pool, listFilters, ctx), sort, { isYours, now, currency, nudge, known: knownAt }),
    [pool, listFilters, ctx, sort, isYours, now, currency, nudge, knownAt],
  );
  const groups = useMemo(() => groupJobs(visible, now), [visible, now]);
  // One company can't fill the page ("+N more at …"), except in Newest (a plain date order) and when you've
  // picked companies yourself.
  // New filters or sort close the companies you opened (and start the list at its first page). Both are kept
  // for the list they were set on, so the reset lands in the same render as the new list (no Effect).
  const listKey = useMemo(() => ({ listFilters, sort }), [listFilters, sort]);
  const [opened, setOpened] = useState<{ for: unknown; set: ReadonlySet<string> }>({ for: null, set: NONE_OPEN });
  const openCompanies = opened.for === listKey ? opened.set : NONE_OPEN;
  const openCompany = (key: string) => setOpened({ for: listKey, set: new Set([...openCompanies, key]) });
  const fold = sort !== "newest" && !filters.mine && !filters.companies.length;
  // Best match: your companies' freshest roles in a strip above the list, and not again in it.
  const strip = useMemo(
    () =>
      sort === "best" && !filters.mine
        ? groups
            .filter((g) => isYours(g.lead))
            .sort((a, b) => postedOrSeen(b.lead).localeCompare(postedOrSeen(a.lead)))
            .slice(0, STRIP)
        : [],
    [sort, filters.mine, groups, isYours],
  );
  const rows: FeedRow[] = useMemo(() => {
    const rest = strip.length ? groups.filter((g) => !strip.includes(g)) : groups;
    return fold ? foldCompanies(rest, openCompanies) : rest.map((group) => ({ kind: "group" as const, group }));
  }, [fold, groups, strip, openCompanies]);
  /** The roles J/K steps through: the strip, then the list's rows, folded ones left out. */
  const navGroups = useMemo(() => [...strip, ...rows.flatMap((r) => (r.kind === "group" ? [r.group] : []))], [strip, rows]);
  const chips = useMemo(() => activeChips(filters, ctx, base), [filters, ctx, base]);
  // Postings past your age limit that the other filters would show: "Show older jobs (N)".
  const olderCount = useMemo(() => (listFilters.showOld ? 0 : roleCount(applyFilters(pool, { ...listFilters, showOld: true }, ctx)) - groups.length), [pool, listFilters, ctx, groups.length]);
  // How many roles "Know someone there" would leave, with everything else as it is.
  const knownCount = useMemo(
    () => (!networkReady ? 0 : listFilters.knownOnly ? groups.length : roleCount(applyFilters(pool, { ...listFilters, knownOnly: true }, ctx))),
    [networkReady, pool, listFilters, ctx, groups.length],
  );

  // Summary numbers over all matches (not the current filters).
  // View counts are within your profile, like the views themselves.
  const open = useMemo(() => applyFilters(jobs, base, ctx), [jobs, base, ctx]);
  // Every count is roles, like the list's rows: one role posted in three cities counts once.
  const newCount = useMemo(() => roleCount(open.filter((j) => isNewJob(j, ctx))), [open, ctx]);
  // A quick-filter chip counts what it shows with the other chips that are on: with Strong on, New says how many new strong jobs.
  const chipCounts = useMemo(() => {
    const chipOn: Record<ChipId, boolean> = { mine: !!filters.mine, new: filters.status === "new", strong: filters.match === "strong" };
    const chipTest: Record<ChipId, (j: Job) => boolean> = { mine: isYours, new: (j) => isNewJob(j, ctx), strong: (j) => j.score >= min };
    const chipIds = Object.keys(chipTest) as ChipId[];
    return Object.fromEntries(chipIds.map((id) => [id, roleCount(open.filter((j) => chipTest[id](j) && chipIds.every((o) => o === id || !chipOn[o] || chipTest[o](j))))])) as Record<ChipId, number>;
  }, [open, ctx, filters.mine, filters.status, filters.match, isYours, min]);
  const yourGroups = useMemo(() => groups.filter((g) => isYours(g.lead)).length, [groups, isYours]);
  // The newest job in the list, said in the head when the list isn't sorted by date.
  const newest = useMemo(() => (sort === "newest" ? undefined : visible.reduce<string | undefined>((m, j) => (!m || postedOrSeen(j) > m ? postedOrSeen(j) : m), undefined)), [sort, visible]);

  // Facet counts are the costliest pass, so they're worked out only while the filter row or sheet shows them.
  const counts = useMemo(() => (i.needFacets ? facetCounts(pool, listFilters, ctx) : undefined), [i.needFacets, pool, listFilters, ctx]);
  const relax = useMemo(() => (groups.length === 0 ? suggestRelax(pool, listFilters, ctx) : []), [groups.length, pool, listFilters, ctx]);

  return {
    min,
    pool,
    ctx,
    industriesByCompany,
    hidden,
    firstScan,
    newSince,
    now,
    maxAgeDays,
    networkReady,
    knownAt,
    learned,
    resetLearned,
    listFilters,
    listKey,
    visible,
    groups,
    strip,
    rows,
    navGroups,
    openCompany,
    chips,
    olderCount,
    knownCount,
    newCount,
    chipCounts,
    yourGroups,
    newest,
    counts,
    relax,
  };
}

export type RadarList = ReturnType<typeof useRadarList>;
