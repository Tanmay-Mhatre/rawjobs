import { surgeTitle } from "@rawjobs/core/activity";
import { sponsorOf, sponsorTitle } from "@rawjobs/core/catalog/visa";
import { fitLine } from "@rawjobs/core/fit";
import { Bookmark, CircleCheck, CircleHelp, CircleX, Star, Users, X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import type { JobGroup } from "../../lib/filters";
import { atsLabel, evergreenReason, isOlder } from "../../lib/filters";
import { isRoleStale, staleReasons } from "../../lib/stale";
import { cleanLocation, companyName, eligibilityNotes, formatSalary, jobTitle, placeSummary, postedOrSeen, shortAge, timeAgo, workplaceBeside } from "../../lib/format";
import { type Entry, followUpDue, referralWord, type Status, statusLabel } from "../../lib/userState";
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
  /** How many of your LinkedIn connections work at the company. */
  known?: number;
};

/** Where the role is, across all its postings: "Berlin +3" (cities when recognised, else the raw location). */
function placeLine(group: JobGroup): string {
  const cities = group.jobs.flatMap((j) => j.cities);
  if (cities.length) return placeSummary(cities);
  const lead = cleanLocation(group.lead.location) || "Location not listed";
  // A job board's copy of the same posting isn't another place.
  const others = new Set(group.jobs.map((j) => cleanLocation(j.location) || "Location not listed")).size - 1;
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

/** The job's best reason and biggest gap under its meta line ("payments · Your title" and "Pay not listed"). */
function FitReasons({ job }: { job: JobGroup["lead"] }) {
  const { reason, gap } = fitLine(job.why, { estimated: job.estimated });
  if (!reason && !gap) return null;
  return (
    <span className="rj-row__meta flex items-center gap-3">
      {reason && (
        <span className="inline-flex min-w-0 items-center gap-1" title={reason}>
          <CircleCheck className="size-3.5 shrink-0 text-success-text" aria-label="Fits:" />
          <span className="truncate">{reason}</span>
        </span>
      )}
      {gap && (
        <span className={cx("inline-flex max-w-[60%] shrink-0 items-center gap-1", gap.tone === "missed" && "text-warning-text")} title={gap.text}>
          {gap.tone === "missed" ? <CircleX className="size-3.5 shrink-0" aria-label="Gap:" /> : <CircleHelp className="size-3.5 shrink-0" aria-label="Unknown:" />}
          <span className="truncate">{gap.text}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The one flag a row carries, most important first: why it's out (closed, failed filter), who can't take
 * it, a dealbreaker, signs it isn't a real opening, then the good news (pay, visa sponsor, hiring surge).
 */
function rowFlag(group: JobGroup): ReactNode {
  const job = group.lead;
  if (job.status === "closed") return <span className="text-danger-text">Closed</span>;
  if (job.why.gate) return <span className="text-warning-text">Failed your {job.why.gate} filter</span>;
  const limit = eligibilityNotes(job.eligibility).find((n) => n.limit);
  if (limit) return <span className="text-warning-text">{limit.text}</span>;
  // A dealbreaker never hides a job: it shows why it scored low.
  const broken = job.why.dealbreakers ?? [];
  if (broken.length)
    return (
      <span className="text-warning-text" title={broken.length > 1 ? broken.join(". ") : undefined}>
        {broken[0]}
        {broken.length > 1 && ` +${broken.length - 1}`}
      </span>
    );
  // One tag for every sign of a ghost job. A role posted in several places is tagged only when every
  // posting may be stale (the lead is a fresh one when there is one: groupJobs).
  const n = group.jobs.length;
  if (isRoleStale(group.jobs))
    return (
      <span className="text-warning-text" title={[...(n > 1 ? [`All ${n} postings may be stale`] : []), ...staleReasons(job)].join(". ")}>
        May be stale
      </span>
    );
  const evergreen = evergreenReason(job);
  if (evergreen === "pool")
    return (
      <span className="text-warning-text" title="A talent pool or open application: it collects applications rather than filling one role">
        Talent pool
      </span>
    );
  const salary = formatSalary(job.salary);
  if (salary) return job.salaryFrom === "description" ? <span title="Read from the job description">{salary}</span> : salary;
  const sponsor = sponsorOf(group.jobs);
  if (sponsor)
    return (
      <span className="text-success-text" title={sponsorTitle(sponsor)}>
        Sponsors visas
      </span>
    );
  // The company is opening far more roles than usual (data/activity.json); never part of the score.
  if (job.surge)
    return (
      <span className="text-ink" title={surgeTitle(companyName(job.company), job.surge)}>
        Hiring surge
      </span>
    );
  if (evergreen === "reposted")
    return (
      <span className="text-warning-text" title="Taken down and posted again: dated from the first posting">
        Reposted
      </span>
    );
  return null;
}

/**
 * One job in the feed (design/components/Feed): score, then title and meta, then the row actions and
 * where the job came from. The title is a real button whose click area stretches over the whole row;
 * Save and Not interested sit above it and show on hover or focus (always on touch screens and phones).
 */
export const JobCard = forwardRef<HTMLLIElement, Props>(function JobCard({ group, entry, min, isNew, selected, onSelect, onStatus, yours, known }, ref) {
  const job = group.lead;
  const status = entry?.status;
  const muted = job.status === "closed" || status === "dismissed" || !!job.why.gate;

  const place = placeLine(group);
  const meta: ReactNode[] = [companyName(job.company), place];
  const workplace = workplaceBeside(place, WORKPLACE[job.workplace]);
  if (workplace) meta.push(workplace);
  // Your own progress always shows; then the one fact that matters most.
  if (entry && status && status !== "dismissed")
    meta.push(followUpDue(entry) ? <span className="text-warning-text">Applied, follow up now</span> : <span className="text-ink">{statusLabel(entry)}</span>);
  // How far a referral got (Messaged, Replied, Referred), from the job's contact log.
  const referral = status !== "dismissed" && referralWord(entry);
  if (referral) meta.push(<span className="text-ink">{referral}</span>);
  if (known)
    meta.push(
      <span className="inline-flex items-center gap-1" title={`${known} ${known === 1 ? "person" : "people"} you know work${known === 1 ? "s" : ""} at ${companyName(job.company)}`}>
        <Users className="rj-icon" aria-hidden />
        {known} you know
      </span>,
    );
  const flag = rowFlag(group);
  if (flag) meta.push(flag);

  return (
    <li ref={ref} className={cx("rj-row", muted && "opacity-60")} aria-current={selected ? "true" : undefined}>
      <span title={job.estimated ? "Estimated: scored on title, place and industry only, until the full posting is fetched" : undefined}>
        <ScoreBadge score={job.score} threshold={min} estimated={job.estimated} word />
      </span>
      <span className="rj-row__main">
        <span className="rj-row__title">
          {yours && <Star className="rj-star" role="img" aria-label="My company" />}
          <button type="button" onClick={onSelect} className="rj-row__link min-w-0 cursor-pointer text-left" data-job-link>
            {jobTitle(job.title)}
          </button>
        </span>
        <Meta parts={meta} />
        {!muted && <FitReasons job={job} />}
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
          title={job.estimated || job.status !== "open" ? `From ${atsLabel(job.ats)}` : `From ${atsLabel(job.ats)}, still listed: checked ${timeAgo(job.lastSeen)}`}
          source=""
          age={shortAge(postedOrSeen(job))}
          isNew={isNew}
          older={isOlder(job)}
        />
      </span>
    </li>
  );
});
