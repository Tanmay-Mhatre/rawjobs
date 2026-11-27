import { displayName } from "@rawjobs/core/display-name";
import { ArrowRight, ArrowUpDown, UserRound } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { DataMeta } from "../../lib/data";
import type { FeedRow, Filters, JobGroup, Sort } from "../../lib/filters";
import { timeAgo } from "../../lib/format";
import { settingsHash } from "../settings/registry";
import { Button } from "../ui";
import { sortsFor } from "./FilterSheet";
import type { RadarList } from "./useRadarList";

/**
 * design/components/Feed: an L1 panel, a summary line, then one list, paged (in Best match, your companies'
 * strip first). Rows are drawn by the page (`card`), which keeps their handlers stable.
 */
export function RadarFeed({
  listRef,
  sentinel,
  ...p
}: {
  list: RadarList;
  density: string;
  sort: Sort;
  setSort: (s: Sort) => void;
  setFilters: (patch: Partial<Filters>) => void;
  lastRun: DataMeta["runs"][number] | undefined;
  wide: boolean;
  /** Laptops with the profile line in the Filters panel: a "Your profile" link in the head opens it. */
  profileToggle: boolean;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onOpenSheet: () => void;
  listRef: RefObject<HTMLDivElement | null>;
  sentinel: RefObject<HTMLLIElement | null>;
  /** The rows on the pages shown so far. */
  shown: FeedRow[];
  hasMore: boolean;
  card: (g: JobGroup) => ReactNode;
}) {
  const { groups, strip, yourGroups, firstScan, newCount, newest, now, learned, networkReady } = p.list;
  const { sort, lastRun } = p;
  const sortLabel = sortsFor(networkReady, sort).find((x) => x.value === sort)?.label;
  return (
    <section aria-label="Jobs for you" className="rj-panel rj-feed lg:flex lg:h-full lg:min-h-0 lg:flex-col" data-density={p.density}>
      <div className="rj-feed__head">
        <span>
          {groups.length} {groups.length === 1 ? "job" : "jobs"}
          {!firstScan && newCount > 0 && ` · ${newCount} new`}
          {newest && (
            <>
              {" · "}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => p.setSort("newest")} title="Sort by newest">
                newest {timeAgo(newest, now)}
              </button>
            </>
          )}
          {lastRun && ` · ${lastRun.everyCompany ? "every company checked" : "checked"} ${timeAgo(lastRun.finishedAt)}`}
          {sort === "best" && learned?.helps && (
            <>
              {" · "}
              <span
                title={`${learned.learned ? `${learned.learned}. ` : ""}Learned from ${learned.liked} jobs you saved or applied to and ${learned.disliked} you marked Not interested, on this computer only. Scores don't change.`}
              >
                order tuned to your picks
              </span>{" "}
              <button type="button" className="underline underline-offset-2" onClick={p.list.resetLearned}>
                Reset
              </button>
            </>
          )}
        </span>
        {/* Laptops show the sort control just above, and keep your profile line in the Filters panel:
            this opens it, so what's being matched is one click away. Phones sort in the filter
            sheet; this opens it. */}
        {p.profileToggle && (
          <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" aria-expanded={p.filtersOpen} aria-controls="radar-filters" onClick={p.onToggleFilters}>
            <UserRound className="size-3" aria-hidden /> Your profile
          </button>
        )}
        {!p.wide && (
          <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={p.onOpenSheet} aria-label={`Sorted by ${sortLabel}. Change sort`}>
            <ArrowUpDown className="size-3" aria-hidden />
            {sortLabel}
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
              {strip.map((g) => p.card(g))}
              {yourGroups > strip.length && (
                <li className="px-4 py-2">
                  <Button variant="ghost" size="sm" onClick={() => p.setFilters({ mine: true })}>
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
          {p.shown.map((r) =>
            r.kind === "group" ? (
              p.card(r.group)
            ) : (
              <li key={`more:${r.key}`} className="px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => p.list.openCompany(r.key)}>
                  +{r.groups.length} more at {displayName(r.company)}
                </Button>
              </li>
            ),
          )}
          {p.hasMore && (
            // No spinner on the feed (design/components/Loading): the next page is already here, it just renders.
            <li ref={sentinel} className="flex items-center gap-2 px-4 py-4 type-small text-muted">
              Loading more…
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/** No list to show: no companies picked yet (My companies), or nothing matches the filters. */
export function RadarEmpty(p: {
  noCompaniesYet: boolean;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  onClear: () => void;
  onCompanies: () => void;
  hasKeywords: boolean;
  relax: RadarList["relax"];
  olderCount: number;
}) {
  const { filters, olderCount } = p;
  if (p.noCompaniesYet)
    return (
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
    );
  return (
    <div className="rj-panel">
      <div className="rj-empty">
        <h2 className="rj-empty__title">{filters.match === "strong" ? "No strong matches yet" : "No jobs match these filters"}</h2>
        {filters.match === "strong" && (
          <p className="rj-empty__body">
            Strong matches need the right title and place, and a description that mentions your keywords.{" "}
            <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => (location.hash = settingsHash("keywords"))}>
              {p.hasKeywords ? "Add more keywords" : "Add keywords"}
            </button>{" "}
            to find more.
          </p>
        )}
        {p.relax.length > 0 ? (
          <div className="rj-empty__actions">
            {p.relax.map((r) => (
              <Button key={r.label} onClick={() => p.setFilters(r.remove)}>
                Remove {r.label}: {r.count} job{r.count === 1 ? "" : "s"}
              </Button>
            ))}
          </div>
        ) : filters.mine ? (
          <p className="rj-empty__body">None of your companies has a matching job right now. They're checked again every scan.</p>
        ) : (
          <div className="rj-empty__actions">
            <Button variant="primary" onClick={p.onClear}>
              Clear filters
            </Button>
            {olderCount > 0 && <Button onClick={() => p.setFilters({ showOld: true })}>Show older jobs ({olderCount})</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
