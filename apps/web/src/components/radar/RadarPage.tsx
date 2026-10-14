import { displayName } from "@rawjobs/core/display-name";
import { ArrowRight, ArrowUpDown, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useOtherJobs, type DataMeta, type Job, type Profile } from "../../lib/data";
import {
  activeChips,
  applyFilters,
  facetCounts,
  foldCompanies,
  groupJobs,
  hasNewTag,
  isNewJob,
  profileFilters,
  profilePlaces,
  roleCount,
  sortJobs,
  suggestRelax,
  type Ctx,
  type FacetKey,
  type FeedRow,
  type Filters,
  type JobGroup,
  type Sort,
} from "../../lib/filters";
import type { Prefs, SavedView } from "../../lib/prefs";
import type { FilterPicks } from "../../lib/profileSync";
import { postedOrSeen, timeAgo } from "../../lib/format";
import { newSinceLastVisit } from "../../lib/newSince";
import { useDensity, useMaxAge } from "../../lib/theme";
import { ignoreShortcut } from "../../lib/keys";
import { load, save } from "../../lib/storage";
import type { Status, UserState } from "../../lib/userState";
import { JobDetail } from "../JobDetail";
import { toast } from "../Toast";
import { Chip, SearchField } from "../primitives";
import { Button, Card } from "../ui";
import { FacetMenu, OptionList } from "./FacetMenu";
import { FilterSheet, SheetSection, SORTS, SortOptions } from "./FilterSheet";
import { JobCard } from "./JobCard";
import { ageLimit, MoreMenu, MoreToggles } from "./MoreFilters";
import { ProfileBar } from "./ProfileBar";
import { builtInViews, ViewsBar } from "./ViewsBar";
import { useHourlyNow, useIsWide, useLatestKeydown } from "./hooks";
import { useClosedSinceToast } from "./useClosedSinceToast";
import { useRadarFilters } from "./useRadarFilters";
import { settingsHash } from "../settings/registry";

type Props = {
  jobs: Job[];
  meta: DataMeta;
  user: UserState;
  prefs: Prefs;
  /** Phones: open the job full screen. */
  onOpenOverlay: (job: Job) => void;
  overlayOpen: boolean;
  onStatus: (job: Job, s: Status) => void;
  onUpdate: (job: Job, patch: { status?: Status; note?: string }) => void;
  onApply: (job: Job) => void;
  onSaveView: (name: string, filters: Filters, sort: Sort) => SavedView;
  onRenameView: (id: string, name: string) => void;
  onDeleteView: (id: string) => void;
  /** Undo a delete: put the view back at its old position. */
  onRestoreView: (view: SavedView, index: number) => void;
  onHideCompany: (company: string, hidden: boolean) => void;
  /** Is this job at one of your companies? Starred, nudged up in Best match, and in a strip on top. */
  isYours: (j: Job) => boolean;
  /** How many companies you've added. */
  companyCount: number;
  /** When the directory index behind the estimated jobs was built. */
  indexGeneratedAt?: string;
  onCompanies: () => void;
  /** Add (or remove) a job's company to your companies (local app only). Resolves to an error, or null. */
  onTrack?: (job: Job, on: boolean) => Promise<string | null>;
  /** Check a directory job's company live now (local app only). Resolves to an error, or null. */
  onCheck?: (job: Job) => Promise<string | null>;
  /** Your saved profile now (Settings); falls back to the one from the last scan. */
  profile?: Profile;
  onEditProfile: () => void;
  /** Save the Radar's place picks to your profile, then rescan. Resolves to an error, or null. */
  onSaveProfile?: (picks: FilterPicks) => Promise<string | null>;
};

/** "Show everywhere" was picked for these profile places (JSON); a change of places brings the place filter back. */
const EVERYWHERE_KEY = "rawjobs.radar.everywhere";
const PAGE = 40;
/** Your companies' freshest roles shown above the list in Best match. */
const STRIP = 3;

export function RadarPage(p: Props) {
  const profile = p.profile ?? p.meta.profile;
  const profileKey = JSON.stringify([profile.locations, profile.industries]);
  // The Radar starts filtered to your places, said out loud in the profile bar, with "Show everywhere" to drop it
  // (remembered until your places change).
  const placesKey = JSON.stringify(profile.locations);
  const [everywhereFor, setEverywhereFor] = useState(() => load<string | null>(EVERYWHERE_KEY, null));
  const everywhere = everywhereFor === placesKey;
  // biome-ignore lint/correctness/useExhaustiveDependencies: profileKey stands for the parts of the profile the filters use
  const placeBase = useMemo(() => profileFilters(profile), [profileKey]);
  const base = useMemo(() => (everywhere ? { ...placeBase, countries: [], locations: [] } : placeBase), [placeBase, everywhere]);
  const { filters, sort, setFilters, setSort, replace, adoptNextProfile } = useRadarFilters(base, placeBase);
  const setEverywhere = (on: boolean) => {
    const v = on ? placesKey : null;
    setEverywhereFor(v);
    save(EVERYWHERE_KEY, v);
    setFilters(on ? { countries: [], locations: [] } : { countries: placeBase.countries, locations: placeBase.locations });
  };
  const wide = useIsWide();
  const density = useDensity();
  const min = p.meta.profile.min_score;
  const other = useOtherJobs(filters.showFailed);
  const pool = useMemo(() => (filters.showFailed && other ? [...p.jobs, ...other] : p.jobs), [p.jobs, other, filters.showFailed]);

  // Industries per company: your companies (from the last scan), and any job that carries its company's.
  const industriesByCompany = useMemo(() => {
    const m = new Map(p.meta.companies.map((c) => [c.name, c.industries ?? []]));
    for (const j of p.jobs) if (j.industries?.length && !m.get(j.company)?.length) m.set(j.company, j.industries);
    return m;
  }, [p.meta.companies, p.jobs]);
  const hidden = useMemo(() => new Set(p.prefs.hiddenCompanies), [p.prefs.hiddenCompanies]);
  // "New to you": first found since your last visit (lib/newSince). On the first scan everything would be, so nothing is.
  const fullRuns = p.meta.runs.filter((r) => !r.partial);
  const firstScan = fullRuns.length <= 1;
  const latestScan = fullRuns[0]?.finishedAt;
  const previousScan = fullRuns[1]?.finishedAt;
  const newSince = useMemo(() => newSinceLastVisit(latestScan, previousScan), [latestScan, previousScan]);
  // One clock for filters, tags and order, moved on every hour.
  const now = useHourlyNow();
  const maxAgeDays = useMaxAge();
  // biome-ignore lint/correctness/useExhaustiveDependencies: profileKey stands for the parts of the profile the context uses
  const ctx: Ctx = useMemo(() => {
    const places = profilePlaces(profile);
    return {
      firstScan,
      newSince,
      now,
      maxAgeDays,
      user: p.user,
      min,
      industriesOf: (c: string) => industriesByCompany.get(c) ?? [],
      hiddenCompanies: hidden,
      hideRules: p.prefs.hideRules,
      isYours: p.isYours,
      mine: { countries: new Set([...places.countries, ...(places.remote ? ["Remote"] : [])]), locations: new Set(places.locations), industries: new Set(profile.industries) },
    };
  }, [p.user, min, industriesByCompany, hidden, p.prefs.hideRules, profileKey, p.isYours, firstScan, newSince, now, maxAgeDays]);

  // One list, in the order you picked: your companies are starred and nudged up in Best match, never pinned.
  // Typing in search updates the box at once; the list catches up when React has a moment (useDeferredValue).
  const q = useDeferredValue(filters.q);
  const listFilters = useMemo(() => (q === filters.q ? filters : { ...filters, q }), [filters, q]);
  const visible = useMemo(
    () => sortJobs(applyFilters(pool, listFilters, ctx), sort, p.isYours, now, profile.salary_floor?.currency),
    [pool, listFilters, ctx, sort, p.isYours, now, profile.salary_floor?.currency],
  );
  const groups = useMemo(() => groupJobs(visible), [visible]);
  // One company can't fill the page ("+N more at …"), except in Newest (a plain date order) and when you've
  // picked companies yourself.
  const [openCompanies, setOpenCompanies] = useState<ReadonlySet<string>>(() => new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: new filters or sort close the companies you opened
  useEffect(() => setOpenCompanies(new Set()), [filters, sort]);
  const fold = sort !== "newest" && !filters.mine && !filters.companies.length;
  // Best match: your companies' freshest roles in a strip above the list, and not again in it.
  const strip = useMemo(
    () =>
      sort === "best" && !filters.mine
        ? groups
            .filter((g) => p.isYours(g.lead))
            .sort((a, b) => postedOrSeen(b.lead).localeCompare(postedOrSeen(a.lead)))
            .slice(0, STRIP)
        : [],
    [sort, filters.mine, groups, p.isYours],
  );
  const rows: FeedRow[] = useMemo(() => {
    const rest = strip.length ? groups.filter((g) => !strip.includes(g)) : groups;
    return fold ? foldCompanies(rest, openCompanies) : rest.map((group) => ({ kind: "group" as const, group }));
  }, [fold, groups, strip, openCompanies]);
  /** The roles J/K steps through: the strip, then the list's rows, folded ones left out. */
  const navGroups = useMemo(() => [...strip, ...rows.flatMap((r) => (r.kind === "group" ? [r.group] : []))], [strip, rows]);
  const counts = useMemo(() => facetCounts(pool, listFilters, ctx), [pool, listFilters, ctx]);
  const chips = useMemo(() => activeChips(filters, ctx, base), [filters, ctx, base]);
  // Postings past your age limit that the other filters would show: "Show older jobs (N)".
  const olderCount = useMemo(() => (listFilters.showOld ? 0 : roleCount(applyFilters(pool, { ...listFilters, showOld: true }, ctx)) - groups.length), [pool, listFilters, ctx, groups.length]);

  // Summary numbers over all matches (not the current filters).
  // View counts are within your profile, like the views themselves.
  const open = useMemo(() => applyFilters(p.jobs, base, ctx), [p.jobs, base, ctx]);
  // Every count is roles, like the list's rows: one role posted in three cities counts once.
  const newCount = roleCount(open.filter((j) => isNewJob(j, ctx)));
  const strongCount = roleCount(open.filter((j) => j.score >= min));
  // Saved and Applied keep jobs that closed or aged out, so they're counted with their own view's filters.
  const savedCount = useMemo(() => roleCount(applyFilters(p.jobs, { ...base, status: "saved" }, ctx)), [p.jobs, base, ctx]);
  const appliedCount = useMemo(() => roleCount(applyFilters(p.jobs, { ...base, status: "applied" }, ctx)), [p.jobs, base, ctx]);
  const yourGroups = groups.filter((g) => p.isYours(g.lead)).length;
  // The newest job in the list, said in the head when the list isn't sorted by date.
  const newest = useMemo(() => (sort === "newest" ? undefined : visible.reduce<string | undefined>((m, j) => (!m || postedOrSeen(j) > m ? postedOrSeen(j) : m), undefined)), [sort, visible]);
  const noCompaniesYet = filters.mine && p.companyCount === 0;

  // ----- list paging and selection -----
  const [limit, setLimit] = useState(PAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new filters or sort start the list at its first page
  useEffect(() => setLimit(PAGE), [filters, sort]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedGroup = groups.find((g) => g.jobs.some((j) => j.id === selectedId)) ?? (wide ? navGroups[0] : undefined);
  const selected = selectedGroup?.jobs.find((j) => j.id === selectedId) ?? selectedGroup?.lead;
  const index = selectedGroup ? navGroups.indexOf(selectedGroup) : -1;
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const sentinel = useRef<HTMLLIElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the list growing or paging moves the sentinel: re-observe it
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setLimit((l) => l + PAGE), { root: wide ? listRef.current : null, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [wide, rows.length, limit]);

  const select = useCallback(
    (job: Job) => {
      setSelectedId(job.id);
      if (!wide) p.onOpenOverlay(job);
    },
    [wide, p],
  );
  /**
   * J/K move focus between rows (design/components/Feed): after the selection changes and the row is
   * rendered with aria-current, focus its title, so focus and the current row never disagree. Not while
   * the phone drawer is open: the list behind it is inert.
   */
  const focusPending = useRef<string | null>(null);
  useEffect(() => {
    const key = focusPending.current;
    if (!key || !selectedGroup || selectedGroup.key !== key) return;
    focusPending.current = null;
    const row = rowRefs.current.get(key);
    if (!(!wide && p.overlayOpen)) row?.querySelector<HTMLElement>("[data-job-link]")?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  });
  const move = useCallback(
    (d: number) => {
      if (!navGroups.length) return;
      const next = Math.max(0, Math.min(navGroups.length - 1, (index < 0 ? -1 : index) + d));
      const g = navGroups[next]!;
      const row = rows.findIndex((r) => r.kind === "group" && r.group === g);
      if (row >= limit) setLimit(row + PAGE);
      setSelectedId(g.lead.id);
      if (!wide && p.overlayOpen) p.onOpenOverlay(g.lead);
      // Focus moves once the new row is rendered and marked current (the effect below).
      focusPending.current = g.key;
    },
    [navGroups, rows, index, limit, wide, p],
  );

  // ----- keyboard: j/k move, s/a/x status, Enter opens (phones), "/" search, 1-6 views -----
  const searchRef = useRef<HTMLInputElement>(null);
  // One listener for the page's life; it calls the latest handler (props change on every render).
  useLatestKeydown((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (ignoreShortcut(e)) return;
    const phoneJob = !wide && p.overlayOpen;
    // Not under some other dialog (the shortcut sheet, "Did you apply?"): the page behind it is inert.
    if (!phoneJob && document.querySelector("dialog[open]")) return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (phoneJob && !["j", "k", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const view = /^[1-6]$/.test(e.key) ? builtInViews(firstScan)[Number(e.key) - 1] : undefined;
    if (view) return replace({ ...base, ...view.filters }, sort);
    if (e.key === "Enter" && t?.closest?.("button, a, [role=button]")) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (!selected) return;
    else if (e.key === "Enter" || e.key === "o") {
      // Desktop: the details are already showing, so Enter opens the job page (and asks "Did you apply?" later).
      if (wide) {
        window.open(selected.url, "_blank", "noopener");
        p.onApply(selected);
      } else p.onOpenOverlay(selected);
    } else if (e.key === "s") p.onStatus(selected, "saved");
    else if (e.key === "a") p.onStatus(selected, "applied");
    else if (e.key === "x") p.onStatus(selected, "dismissed");
  });

  // ----- jobs you saved or applied to that closed since your last visit: said once per visit -----
  useClosedSinceToast(newSince, p.jobs, p.user, (view) => replace({ ...base, status: view }, sort));

  // ----- hide a company, with undo -----
  const hideCompany = (company: string, hide: boolean) => {
    p.onHideCompany(company, hide);
    if (hide)
      toast({
        message: (
          <>
            Hid all jobs from <b>{company}</b>.
          </>
        ),
        actionLabel: "Undo",
        onAction: () => p.onHideCompany(company, false),
      });
  };
  const deleteView = (view: SavedView) => {
    const index = p.prefs.views.findIndex((v) => v.id === view.id);
    p.onDeleteView(view.id);
    toast({
      message: (
        <>
          Deleted the view <b>{view.name}</b>.
        </>
      ),
      actionLabel: "Undo",
      onAction: () => p.onRestoreView(view, index),
    });
  };

  const [sheet, setSheet] = useState(false);
  /** Laptops and up: the filter row under the search, opened with Filters. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Seniority, industry, company and keywords: shown on request, so the first row holds the common ones. */
  const [moreFacets, setMoreFacets] = useState(false);
  const facet = (key: FacetKey) => counts[key];
  const relax = useMemo(() => (groups.length === 0 ? suggestRelax(pool, listFilters, ctx) : []), [groups.length, pool, listFilters, ctx]);

  /** One role's row, in the strip or the list: each role shows once, and J/K moves focus to it. */
  const card = (g: JobGroup) => (
    <JobCard
      key={g.key}
      ref={(el) => {
        if (el) rowRefs.current.set(g.key, el);
        else rowRefs.current.delete(g.key);
      }}
      group={g}
      entry={p.user[g.lead.id]}
      min={min}
      isNew={hasNewTag(g.lead, ctx)}
      selected={!!selectedGroup && g.key === selectedGroup.key && (wide || p.overlayOpen)}
      onSelect={() => select(g.lead)}
      onStatus={(st) => p.onStatus(g.lead, st)}
      yours={p.isYours(g.lead)}
    />
  );

  // One list (design/components/Feed), paged; in Best match, your companies' strip above it.
  const shown = rows.slice(0, limit);

  const detailProps = selected && {
    job: selected,
    isNew: hasNewTag(selected, ctx),
    entry: p.user[selected.id],
    profile: p.meta.profile,
    postings: selectedGroup!.jobs,
    industries: industriesByCompany.get(selected.company),
    moreFromCompany: sortJobs(
      p.jobs.filter((j) => j.company === selected.company && j.group !== selected.group && j.status === "open"),
      "best",
    ).slice(0, 5),
    yours: p.isYours(selected),
    indexGeneratedAt: p.indexGeneratedAt,
    onTrack: p.onTrack && ((on: boolean) => p.onTrack!(selected, on)),
    onCheck: p.onCheck && selected.estimated ? () => p.onCheck!(selected) : undefined,
    companyHidden: hidden.has(selected.company),
    onUpdate: (patch: { status?: Status; note?: string }) => p.onUpdate(selected, patch),
    onApply: p.onApply,
    onHideCompany: (h: boolean) => hideCompany(selected.company, h),
    onOpenJob: (j: Job) => setSelectedId(j.id),
    onPrev: index > 0 ? () => move(-1) : undefined,
    onNext: index < navGroups.length - 1 ? () => move(1) : undefined,
  };

  // Have the place or industry filters moved away from your profile?
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const changedFromProfile = !sameSet(filters.countries, base.countries) || !sameSet(filters.locations, base.locations);

  const profileBar = (
    <ProfileBar
      profile={profile}
      placeFilter={placeBase.countries}
      everywhere={everywhere}
      onEverywhere={setEverywhere}
      changed={changedFromProfile}
      onEdit={p.onEditProfile}
      onReset={() => setFilters({ countries: base.countries, locations: base.locations })}
      onSave={
        p.onSaveProfile &&
        (() => {
          adoptNextProfile();
          return p.onSaveProfile!({ countries: filters.countries, locations: filters.locations }).then((err) => {
            if (err) adoptNextProfile(false);
            return err;
          });
        })
      }
    />
  );
  // Laptops and up: one row of views, search, sort and Filters, so the feed starts high and the job's
  // Apply stays in view. The filters, active chips and your profile line open under it on request.
  // Phones keep the profile line on top and the filter sheet. A profile that differs needs a decision,
  // so that line always shows.
  const profileOutside = !wide || changedFromProfile;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {profileOutside && profileBar}

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:gap-3">
          <ViewsBar
            className="order-3 w-full lg:order-none lg:w-auto lg:min-w-0 lg:flex-1"
            base={base}
            filters={filters}
            sort={sort}
            views={p.prefs.views}
            counts={{ all: roleCount(open), mine: roleCount(open.filter(p.isYours)), new: newCount, strong: strongCount, saved: savedCount, applied: appliedCount }}
            hideNew={firstScan}
            onPick={replace}
            onSave={(name) => p.onSaveView(name, filters, sort)}
            onRename={p.onRenameView}
            onDelete={deleteView}
          />
          <SearchField
            ref={searchRef}
            label="Search jobs"
            className="order-1 min-w-0 flex-1 basis-40 lg:order-none lg:w-48 lg:flex-none lg:basis-auto xl:w-64"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.currentTarget.blur();
              setFilters({ q: "" });
            }}
            placeholder="Search jobs"
          />
          {/* Phones sort in the filter sheet, so search and Filters share one row. */}
          <label className="relative hidden shrink-0 items-center lg:inline-flex">
            <ArrowUpDown className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="h-9 appearance-none rounded-md border border-line bg-raised pl-8 pr-3 type-small">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="order-2 shrink-0 lg:order-none"
            aria-expanded={wide ? filtersOpen : undefined}
            aria-controls={wide ? "radar-filters" : undefined}
            aria-pressed={chips.length > 0 || undefined}
            onClick={() => (wide ? setFiltersOpen((o) => !o) : setSheet(true))}
          >
            <SlidersHorizontal className="rj-icon" aria-hidden /> Filters{chips.length ? ` · ${chips.length}` : ""}
          </Button>
        </div>

        {wide && filtersOpen && (
          <div id="radar-filters" className="mt-3 space-y-2 border-t border-hairline pt-3">
            {!profileOutside && profileBar}
            <div className="flex flex-wrap items-center gap-1.5">
              <FacetMenu
                label="Date posted"
                single
                options={facet("posted")}
                selected={filters.posted ? [String(filters.posted)] : []}
                onChange={(v) => setFilters({ posted: (Number(v[0]) || 0) as Filters["posted"] })}
              />
              <FacetMenu label="Country" searchable options={facet("countries")} selected={filters.countries} onChange={(v) => setFilters({ countries: v })} />
              <FacetMenu label="Location" searchable options={facet("locations")} selected={filters.locations} onChange={(v) => setFilters({ locations: v })} />
              <FacetMenu label="Workplace" options={facet("workplace")} selected={filters.workplace} onChange={(v) => setFilters({ workplace: v as Filters["workplace"] })} />
              <FacetMenu
                label="Match"
                single
                options={facet("match")}
                selected={filters.match === "all" ? [] : [filters.match]}
                onChange={(v) => setFilters({ match: (v[0] as Filters["match"]) ?? "all" })}
              />
              {/* The rest on request; one that's filtering something always shows. */}
              {(moreFacets || filters.seniority.length > 0) && (
                <FacetMenu label="Seniority" options={facet("seniority")} selected={filters.seniority} onChange={(v) => setFilters({ seniority: v as Filters["seniority"] })} />
              )}
              {(moreFacets || filters.industries.length > 0) && facet("industries").length > 0 && (
                <FacetMenu label="Industry" options={facet("industries")} selected={filters.industries} onChange={(v) => setFilters({ industries: v })} />
              )}
              {(moreFacets || filters.companies.length > 0) && (
                <FacetMenu label="Company" searchable options={facet("companies")} selected={filters.companies} onChange={(v) => setFilters({ companies: v })} />
              )}
              {(moreFacets || filters.topics.length > 0) && facet("topics").length > 0 && (
                <FacetMenu label="Keywords" searchable options={facet("topics")} selected={filters.topics} onChange={(v) => setFilters({ topics: v })} />
              )}
              <MoreMenu
                filters={filters}
                setFilters={setFilters}
                ats={facet("ats")}
                olderCount={olderCount}
                maxAgeDays={maxAgeDays}
                hiddenCompanies={p.prefs.hiddenCompanies.length}
                hideRules={p.prefs.hideRules.length}
              />
              <Button variant="ghost" size="sm" aria-expanded={moreFacets} onClick={() => setMoreFacets((o) => !o)}>
                {moreFacets ? "Fewer filters" : "More filters"}
              </Button>
            </div>
          </div>
        )}

        {(chips.length > 0 || olderCount > 0) && (wide ? filtersOpen : true) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2">
            {chips.map((c) => (
              // An active filter: pressed; pressing it turns it off.
              <Chip key={c.key} pressed onClick={() => setFilters(c.remove)} aria-label={`Filter: ${c.label}`} title="Remove this filter">
                {c.label} <X className="rj-icon" aria-hidden />
              </Chip>
            ))}
            {chips.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => replace(base, sort)}>
                Clear all
              </Button>
            )}
            {olderCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ showOld: true })}
                title={`Postings older than ${ageLimit(maxAgeDays)} are hidden: they're usually filled. Change this in Settings › Matching.`}
              >
                Show older jobs ({olderCount})
              </Button>
            )}
          </div>
        )}
      </Card>

      {noCompaniesYet ? (
        <div className="rj-panel">
          <div className="rj-empty">
            <h2 className="rj-empty__title">No companies picked yet</h2>
            <p className="rj-empty__body">Add the companies you'd love to work at. They're checked every scan, starred in your list, and their newest jobs show on top.</p>
            <div className="rj-empty__actions">
              <Button variant="primary" onClick={p.onCompanies}>
                Pick my companies <ArrowRight className="rj-icon" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="rj-panel">
          <div className="rj-empty">
            <h2 className="rj-empty__title">{filters.match === "strong" ? "No strong matches yet" : "No jobs match these filters"}</h2>
            {filters.match === "strong" && (
              <p className="rj-empty__body">
                Strong matches need the right title and place, and a description that mentions your keywords.{" "}
                <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => (location.hash = settingsHash("keywords"))}>
                  {Object.keys(p.profile?.keywords ?? {}).length ? "Add more keywords" : "Add keywords"}
                </button>{" "}
                to find more.
              </p>
            )}
            {relax.length > 0 ? (
              <div className="rj-empty__actions">
                {relax.map((r) => (
                  <Button key={r.label} onClick={() => setFilters(r.remove)}>
                    Remove {r.label}: {r.count} job{r.count === 1 ? "" : "s"}
                  </Button>
                ))}
              </div>
            ) : filters.mine ? (
              <p className="rj-empty__body">None of your companies has a matching job right now. They're checked again every scan.</p>
            ) : (
              <div className="rj-empty__actions">
                <Button variant="primary" onClick={() => replace(base, sort)}>
                  Clear filters
                </Button>
                {olderCount > 0 && <Button onClick={() => setFilters({ showOld: true })}>Show older jobs ({olderCount})</Button>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
          {/* design/components/Feed: an L1 panel, a summary line, then one list (in Best match, your companies' strip first). */}
          <section aria-label="Jobs for you" className="rj-panel rj-feed lg:flex lg:h-full lg:min-h-0 lg:flex-col" data-density={density}>
            <div className="rj-feed__head">
              <span>
                {groups.length} {groups.length === 1 ? "job" : "jobs"}
                {!firstScan && newCount > 0 && ` · ${newCount} new`}
                {newest && (
                  <>
                    {" · "}
                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => setSort("newest")} title="Sort by newest">
                      newest {timeAgo(newest, now)}
                    </button>
                  </>
                )}
                {p.meta.runs[0] && ` · checked ${timeAgo(p.meta.runs[0].finishedAt)}`}
              </span>
              {/* Laptops show the sort control just above, and keep your profile line in the Filters panel:
                  this opens it, so what's being matched is one click away. Phones sort in the filter
                  sheet; this opens it. */}
              {wide && !profileOutside && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  aria-expanded={filtersOpen}
                  aria-controls="radar-filters"
                  onClick={() => setFiltersOpen((o) => !o)}
                >
                  <UserRound className="size-3" aria-hidden /> Your profile
                </button>
              )}
              {!wide && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  onClick={() => setSheet(true)}
                  aria-label={`Sorted by ${SORTS.find((x) => x.value === sort)?.label}. Change sort`}
                >
                  <ArrowUpDown className="size-3" aria-hidden />
                  {SORTS.find((x) => x.value === sort)?.label}
                </button>
              )}
            </div>
            <div ref={listRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {strip.length > 0 && (
                <>
                  <h2 className="rj-feed__section" id="feed-mine">
                    Latest at my companies <span className="tabular font-normal">{yourGroups}</span>
                  </h2>
                  <ul className="rj-feed__list" aria-labelledby="feed-mine">
                    {strip.map((g) => card(g))}
                    {yourGroups > strip.length && (
                      <li className="px-4 py-2">
                        <Button variant="ghost" size="sm" onClick={() => setFilters({ mine: true })}>
                          See all {yourGroups} from my companies <ArrowRight className="rj-icon" aria-hidden />
                        </Button>
                      </li>
                    )}
                  </ul>
                  <h2 className="rj-feed__section sticky top-0 z-sticky" id="feed-all">
                    Everything else <span className="tabular font-normal">{groups.length - strip.length}</span>
                  </h2>
                </>
              )}
              <ul className="rj-feed__list" aria-labelledby={strip.length ? "feed-all" : undefined} aria-label={strip.length ? undefined : "Jobs"}>
                {shown.map((r) =>
                  r.kind === "group" ? (
                    card(r.group)
                  ) : (
                    <li key={`more:${r.company}`} className="px-4 py-2">
                      <Button variant="ghost" size="sm" onClick={() => setOpenCompanies((s) => new Set([...s, r.company]))}>
                        +{r.groups.length} more at {displayName(r.company)}
                      </Button>
                    </li>
                  ),
                )}
                {limit < rows.length && (
                  // No spinner on the feed (design/components/Loading): the next page is already here, it just renders.
                  <li ref={sentinel} className="flex items-center gap-2 px-4 py-4 type-small text-muted">
                    Loading more…
                  </li>
                )}
              </ul>
            </div>
          </section>
          {wide && (
            <Card className="hidden overflow-hidden lg:block lg:h-full lg:min-h-0">
              {detailProps ? <JobDetail {...detailProps} /> : <p className="p-6 type-small text-muted">Pick a job to see the details.</p>}
            </Card>
          )}
        </div>
      )}

      {sheet && !wide && (
        <FilterSheet onClose={() => setSheet(false)} count={groups.length} onClear={() => replace(base, sort)}>
          <SheetSection label="Sort by">
            <SortOptions sort={sort} onChange={setSort} />
          </SheetSection>
          <SheetSection label="Date posted">
            <OptionList
              label="Date posted"
              single
              options={facet("posted")}
              selected={filters.posted ? [String(filters.posted)] : []}
              onChange={(v) => setFilters({ posted: (Number(v[0]) || 0) as Filters["posted"] })}
            />
          </SheetSection>
          <SheetSection label="Country">
            <OptionList label="Country" searchable options={facet("countries")} selected={filters.countries} onChange={(v) => setFilters({ countries: v })} />
          </SheetSection>
          <SheetSection label="Location">
            <OptionList label="Location" searchable options={facet("locations")} selected={filters.locations} onChange={(v) => setFilters({ locations: v })} />
          </SheetSection>
          <SheetSection label="Workplace">
            <OptionList label="Workplace" options={facet("workplace")} selected={filters.workplace} onChange={(v) => setFilters({ workplace: v as Filters["workplace"] })} />
          </SheetSection>
          <SheetSection label="Seniority">
            <OptionList label="Seniority" options={facet("seniority")} selected={filters.seniority} onChange={(v) => setFilters({ seniority: v as Filters["seniority"] })} />
          </SheetSection>
          {facet("industries").length > 0 && (
            <SheetSection label="Industry">
              <OptionList label="Industry" options={facet("industries")} selected={filters.industries} onChange={(v) => setFilters({ industries: v })} />
            </SheetSection>
          )}
          <SheetSection label="Match">
            <OptionList
              label="Match"
              single
              options={facet("match")}
              selected={filters.match === "all" ? [] : [filters.match]}
              onChange={(v) => setFilters({ match: (v[0] as Filters["match"]) ?? "all" })}
            />
          </SheetSection>
          <SheetSection label="Company">
            <OptionList label="Company" searchable options={facet("companies")} selected={filters.companies} onChange={(v) => setFilters({ companies: v })} />
          </SheetSection>
          {facet("topics").length > 0 && (
            <SheetSection label="Keywords">
              <OptionList label="Keywords" searchable options={facet("topics")} selected={filters.topics} onChange={(v) => setFilters({ topics: v })} />
            </SheetSection>
          )}
          <SheetSection label="More">
            <MoreToggles filters={filters} setFilters={setFilters} olderCount={olderCount} maxAgeDays={maxAgeDays} />
          </SheetSection>
          {facet("ats").length > 1 && (
            <SheetSection label="Hiring system">
              <OptionList label="Hiring system" options={facet("ats")} selected={filters.ats} onChange={(v) => setFilters({ ats: v })} />
            </SheetSection>
          )}
        </FilterSheet>
      )}
    </div>
  );
}
