import { Bookmark, Star, X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import type { JobGroup } from "../../lib/filters";
import { atsLabel, evergreenReason, isOlder } from "../../lib/filters";
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
};

/** Where the role is, across all its postings: "Berlin +3" (cities when recognised, else the raw location). */
function placeLine(group: JobGroup): string {
  const cities = group.jobs.flatMap((j) => j.cities);
  if (cities.length) return placeSummary(cities);
  const lead = group.lead.location || "Location not listed";
  return group.jobs.length > 1 ? `${lead} +${group.jobs.length - 1}` : lead;
}

const WORKPLACE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/** "Acme · Dubai · Hybrid": the facts joined with the kit's separator. */
function Meta({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="rj-row__meta">
      {parts.map((p, i) => (
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
export const JobCard = forwardRef<HTMLLIElement, Props>(function JobCard({ group, entry, min, isNew, selected, onSelect, onStatus, yours }, ref) {
  const job = group.lead;
  const salary = formatSalary(job.salary);
  const status = entry?.status;
  const muted = job.status === "closed" || status === "dismissed" || !!job.why.gate;

  const meta: ReactNode[] = [job.company, placeLine(group)];
  if (WORKPLACE[job.workplace]) meta.push(WORKPLACE[job.workplace]);
  if (salary) meta.push(salary);
  if (status && status !== "dismissed") meta.push(<span className="text-ink">{STATUS_LABEL[status]}</span>);
  const evergreen = evergreenReason(job);
  if (evergreen === "pool")
    meta.push(
      <span className="text-warning-text" title="A talent pool or open application: it collects applications rather than filling one role">
        Talent pool
      </span>,
    );
  if (evergreen === "reposted")
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
