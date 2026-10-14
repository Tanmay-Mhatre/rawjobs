import { surgeTitle } from "@rawjobs/core/activity";
import { sponsorOf, sponsorTitle } from "@rawjobs/core/catalog/visa";
import { fromJobBoard } from "@rawjobs/core/dashboard";
import { displayName } from "@rawjobs/core/display-name";
import { Bookmark, Star, X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import type { JobGroup } from "../../lib/filters";
import { atsLabel, evergreenReason, isOlder } from "../../lib/filters";
import { isRoleStale, staleReasons } from "../../lib/stale";
import { formatSalary, placeSummary, postedOrSeen, shortAge, timeAgo } from "../../lib/format";
import { STATUS_LABEL, type Entry, type Status } from "../../lib/userState";
import { IconButton, ScoreBadge, SourceTag } from "../primitives";
import { cx } from "../ui";

type Props = {
  group: JobGroup;
  entry?: Entry;
  min: number;
  isNew: boolean;
  selected: boolean;
  onSelect: () => void;
  onStatus: (s: Status) => void;
  /** At one of your companies. */
  yours?: boolean;
  /** At a company in one of your industries (they rank higher; the tag says why). */
  yourIndustry?: boolean;
};

/** Where the role is, across all its postings: "Berlin +3" (cities when recognised, else the raw location). */
function placeLine(group: JobGroup): string {
  const cities = group.jobs.flatMap((j) => j.cities);
  if (cities.length) return placeSummary(cities);
  const lead = group.lead.location || "Location not listed";
  // A job board's copy of the same posting isn't another place.
  const others = new Set(group.jobs.map((j) => j.location || "Location not listed")).size - 1;
  return others > 0 ? `${lead} +${others}` : lead;
}

const WORKPLACE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/** "Acme · Dubai · Hybrid": the facts joined with the kit's separator. */
function Meta({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="rj-row__meta">
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
        <span key={i}>
          {i > 0 && (
            <span className="rj-sep" aria-hidden>
              ·
            </span>
          )}
          {p}
        </span>
      ))}
    </span>
  );
}

/**
 * One job in the feed (design/components/Feed): score, then title and meta, then the row actions and
 * where the job came from. The title is a real button whose click area stretches over the whole row;
 * Save and Not interested sit above it and show on hover or focus (always on touch screens and phones).
 */
export const JobCard = forwardRef<HTMLLIElement, Props>(function JobCard({ group, entry, min, isNew, selected, onSelect, onStatus, yours, yourIndustry }, ref) {
  const job = group.lead;
  const salary = formatSalary(job.salary);
  const status = entry?.status;
  const muted = job.status === "closed" || status === "dismissed" || !!job.why.gate;

  const meta: ReactNode[] = [displayName(job.company), placeLine(group)];
  if (WORKPLACE[job.workplace]) meta.push(WORKPLACE[job.workplace]);
  if (yourIndustry)
    meta[meta.length - 1] = (
      <>
        {meta[meta.length - 1]} <span className="rj-ind">Your industry</span>
      </>
    );
  // Before the salary: a long salary would cut it off the line.
  const sponsor = sponsorOf(group.jobs);
  if (sponsor)
    meta.push(
      <span className="text-success-text" title={sponsorTitle(sponsor)}>
        Sponsors visas
      </span>,
    );
  // The company is opening far more roles than usual (data/activity.json); never part of the score.
  if (job.surge)
    meta.push(
      <span className="text-ink" title={surgeTitle(displayName(job.company), job.surge)}>
        Hiring surge
      </span>,
    );
  if (salary) meta.push(salary);
  // The company's own posting leads; its job-board copies are named, not shown as more rows.
  const boards = fromJobBoard(job) ? [] : [...new Set(group.jobs.filter(fromJobBoard).map((j) => atsLabel(j.ats)))];
  if (boards.length) meta.push(boards.length === 1 ? `Also on ${boards[0]}` : `Also on ${boards.length} job boards`);
  if (status && status !== "dismissed") meta.push(<span className="text-ink">{STATUS_LABEL[status]}</span>);
  const evergreen = evergreenReason(job);
  if (evergreen === "pool")
    meta.push(
      <span className="text-warning-text" title="A talent pool or open application: it collects applications rather than filling one role">
        Talent pool
      </span>,
    );
  // One tag for every sign of a ghost job; a repost alone keeps its own note. A role posted in several places
  // is tagged only when every posting may be stale (the lead is a fresh one when there is one: groupJobs).
  const n = group.jobs.length;
  if (isRoleStale(group.jobs))
    meta.push(
      <span className="text-warning-text" title={[...(n > 1 ? [`All ${n} postings may be stale`] : []), ...staleReasons(job)].join(". ")}>
        May be stale
      </span>,
    );
  else if (evergreen === "reposted")
    meta.push(
      <span className="text-warning-text" title="Taken down and posted again: dated from the first posting">
        Reposted
      </span>,
    );
  if (job.status === "closed") meta.push(<span className="text-danger-text">Closed</span>);
  if (job.why.gate) meta.push(<span className="text-warning-text">Failed your {job.why.gate} filter</span>);
  // A dealbreaker never hides a job: it shows why it scored low.
  const broken = job.why.dealbreakers ?? [];
  if (broken.length)
    meta.push(
      <span className="text-warning-text" title={broken.length > 1 ? broken.join(". ") : undefined}>
        {broken[0]}
        {broken.length > 1 && ` +${broken.length - 1}`}
      </span>,
    );

  return (
    <li ref={ref} className={cx("rj-row", muted && "opacity-60")} aria-current={selected ? "true" : undefined}>
      <span title={job.estimated ? "Estimated: scored on title, place and industry only, until the full posting is fetched" : undefined}>
        <ScoreBadge score={job.score} threshold={min} estimated={job.estimated} />
      </span>
      <span className="rj-row__main">
        <span className="rj-row__title">
          {yours && <Star className="rj-star" role="img" aria-label="My company" />}
          <button type="button" onClick={onSelect} className="rj-row__link min-w-0 cursor-pointer text-left" data-job-link>
            {job.title}
          </button>
        </span>
        <Meta parts={meta} />
      </span>
      <span className="rj-row__side">
        {/* Kept visible once used, so a saved or hidden row shows it at a glance. */}
        <span className={cx("rj-row__actions", (status === "saved" || status === "dismissed") && "opacity-100")}>
          <IconButton label="Save" shortcut="S" size="sm" aria-pressed={status === "saved"} className={cx(status === "saved" && "bg-active text-ink")} onClick={() => onStatus("saved")}>
            <Bookmark className={cx("rj-icon", status === "saved" && "fill-current")} aria-hidden />
          </IconButton>
          <IconButton
            label="Not interested"
            shortcut="X"
            size="sm"
            aria-pressed={status === "dismissed"}
            className={cx(status === "dismissed" && "bg-active text-ink")}
            onClick={() => onStatus("dismissed")}
          >
            <X className="rj-icon" aria-hidden />
          </IconButton>
        </span>
        <SourceTag
          title={job.estimated || job.status !== "open" ? undefined : `Still listed on the careers page · checked ${timeAgo(job.lastSeen)}`}
          source={atsLabel(job.ats)}
          age={shortAge(postedOrSeen(job))}
          isNew={isNew}
          older={isOlder(job)}
        />
      </span>
    </li>
  );
});
