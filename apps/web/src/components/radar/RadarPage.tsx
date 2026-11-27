import { memo, useMemo, useRef, useState } from "react";
import type { DataMeta, Job, Profile } from "../../lib/data";
import { hasNewTag, profileFilters, type Filters, type JobGroup, type Sort } from "../../lib/filters";
import { ignoreShortcut } from "../../lib/keys";
import type { Prefs, SavedView } from "../../lib/prefs";
import type { FilterPicks } from "../../lib/profileSync";
import { load, save } from "../../lib/storage";
import { useDensity } from "../../lib/theme";
import type { EntryPatch, Status, UserState } from "../../lib/userState";
import { JobCard } from "./JobCard";
import { ProfileBar } from "./ProfileBar";
import { RadarDetail } from "./RadarDetail";
import { RadarEmpty, RadarFeed } from "./RadarFeed";
import { RadarFilterSheet } from "./RadarFilterSheet";
import { RadarToolbar } from "./RadarToolbar";
import { chipKeys, toggleChip } from "./ViewsBar";
import { useIsWide, useLatestKeydown, useStableHandler } from "./hooks";
import { useClosedSinceToast } from "./useClosedSinceToast";
import { useRadarFilters } from "./useRadarFilters";
import { useRadarList } from "./useRadarList";
import { useRadarNav } from "./useRadarNav";

type Props = {
  jobs: Job[];
  meta: DataMeta;
  user: UserState;
  prefs: Prefs;
  /** Phones: open the job full screen. */
  onOpenOverlay: (job: Job) => void;
  overlayOpen: boolean;
  onStatus: (job: Job, s: Status) => void;
  onUpdate: (job: Job, patch: EntryPatch) => void;
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

/**
 * The Radar. memo: App re-renders for reasons of its own (a dialog, the header), and its props for the Radar
 * stay the same function and data across those, so the Radar skips them.
 * The list is worked out in useRadarList; this composes the toolbar, the feed, the details and the phone sheet.
 */
export const RadarPage = memo(function RadarPage(p: Props) {
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
  const [sheet, setSheet] = useState(false);
  /** Laptops and up: the filter row under the search, opened with Filters. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toggleFilters = () => setFiltersOpen((o) => !o);
  const list = useRadarList({ jobs: p.jobs, meta: p.meta, user: p.user, prefs: p.prefs, isYours: p.isYours, profile, profileKey, base, filters, sort, needFacets: wide ? filtersOpen : sheet });
  const { min, ctx, groups, rows, navGroups, knownAt, firstScan } = list;

  // ----- list paging and selection -----
  const { onOpenOverlay, overlayOpen } = p;
  const { limit, selectedGroup, selected, index, listRef, sentinel, select, move, registerRow, openJob } = useRadarNav(list, wide, overlayOpen, onOpenOverlay);

  // ----- keyboard: j/k move, s/a/x status, Enter opens (phones), "/" search, 1-3 quick filters -----
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
    const chip = /^[1-3]$/.test(e.key) ? chipKeys(firstScan)[Number(e.key) - 1] : undefined;
    if (chip) return replace(toggleChip(filters, base, chip), sort);
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
  useClosedSinceToast(list.newSince, p.jobs, p.user, (view) => replace({ ...base, status: view }, sort));

  // Rows and the details panel are memo components: their handlers stay the same function across renders.
  const onCardSelect = useStableHandler(select);
  const onCardStatus = useStableHandler(p.onStatus);

  /** One role's row, in the strip or the list: each role shows once, and J/K moves focus to it. */
  const card = (g: JobGroup) => (
    <JobCard
      key={g.key}
      register={registerRow}
      group={g}
      entry={p.user[g.lead.id]}
      min={min}
      isNew={hasNewTag(g.lead, ctx)}
      selected={!!selectedGroup && g.key === selectedGroup.key && (wide || p.overlayOpen)}
      onSelect={onCardSelect}
      onStatus={onCardStatus}
      yours={p.isYours(g.lead)}
      known={knownAt?.(g.lead)}
    />
  );

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
  // Laptops keep your profile line in the Filters panel; phones keep it on top. A profile that differs needs a
  // decision, so that line always shows.
  const profileOutside = !wide || changedFromProfile;
  const more = { olderCount: list.olderCount, maxAgeDays: list.maxAgeDays, hiringReady: p.meta.hiringReady, networkReady: list.networkReady, knownCount: list.knownCount };
  const clear = () => replace(base, sort);
  const noCompaniesYet = !!filters.mine && p.companyCount === 0;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {profileOutside && profileBar}

      <RadarToolbar
        wide={wide}
        base={base}
        filters={filters}
        sort={sort}
        setFilters={setFilters}
        setSort={setSort}
        replace={replace}
        views={p.prefs.views}
        chipCounts={list.chipCounts}
        firstScan={firstScan}
        onSaveView={(name) => p.onSaveView(name, filters, sort)}
        onRenameView={p.onRenameView}
        onDeleteView={p.onDeleteView}
        onRestoreView={p.onRestoreView}
        searchRef={searchRef}
        filtersOpen={filtersOpen}
        onToggleFilters={toggleFilters}
        onOpenSheet={() => setSheet(true)}
        chips={list.chips}
        profileBar={profileOutside ? undefined : profileBar}
        counts={list.counts}
        hiddenCompanies={p.prefs.hiddenCompanies.length}
        hideRules={p.prefs.hideRules.length}
        {...more}
      />

      {noCompaniesYet || groups.length === 0 ? (
        <RadarEmpty
          noCompaniesYet={noCompaniesYet}
          filters={filters}
          setFilters={setFilters}
          onClear={clear}
          onCompanies={p.onCompanies}
          hasKeywords={Object.keys(p.profile?.keywords ?? {}).length > 0}
          relax={list.relax}
          olderCount={list.olderCount}
        />
      ) : (
        <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
          <RadarFeed
            list={list}
            density={density}
            sort={sort}
            setSort={setSort}
            setFilters={setFilters}
            lastRun={p.meta.runs[0]}
            wide={wide}
            profileToggle={wide && !profileOutside}
            filtersOpen={filtersOpen}
            onToggleFilters={toggleFilters}
            onOpenSheet={() => setSheet(true)}
            listRef={listRef}
            sentinel={sentinel}
            shown={rows.slice(0, limit)}
            hasMore={limit < rows.length}
            card={card}
          />
          {wide && (
            <RadarDetail
              selected={selected}
              postings={selectedGroup?.jobs ?? []}
              ctx={ctx}
              jobs={p.jobs}
              user={p.user}
              profile={p.meta.profile}
              industriesByCompany={list.industriesByCompany}
              hidden={list.hidden}
              isYours={p.isYours}
              indexGeneratedAt={p.indexGeneratedAt}
              hasPrev={index > 0}
              hasNext={index < navGroups.length - 1}
              move={move}
              onOpenJob={openJob}
              onUpdate={p.onUpdate}
              onApply={p.onApply}
              onHideCompany={p.onHideCompany}
              onTrack={p.onTrack}
              onCheck={p.onCheck}
            />
          )}
        </div>
      )}

      {sheet && !wide && (
        <RadarFilterSheet
          onClose={() => setSheet(false)}
          count={groups.length}
          onClear={clear}
          sort={sort}
          setSort={setSort}
          filters={filters}
          setFilters={setFilters}
          counts={list.counts}
          {...more}
        />
      )}
    </div>
  );
});
