import { ArrowLeft, ChevronDown, ChevronUp, Maximize2, Star, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { Job } from "../../lib/data";
import { cleanLocation, companyName, formatDate, jobTitle, placeSummary, postedOrSeen, timeAgo, workplaceBeside } from "../../lib/format";
import { evergreenReason, isOlder } from "../../lib/filters";
import type { Status } from "../../lib/userState";
import { IconButton } from "../primitives";
import { MetaLine } from "./MetaLine";
import { PeopleYouKnow } from "./PeopleYouKnow";
import { WORKPLACE_LABEL } from "./labels";

/** An open job its board hasn't confirmed for this long may be gone: even the quietest boards are read every 3 days (board-health.ts). */
const RECHECK_DAYS = 4;

/** The drawer's head: the company, prev/next/expand/close, the title, one meta line (where, how fresh, where it's listed) and "N you know". */
export function JobHeader(p: {
  job: Job;
  status?: Status;
  /** Other postings of the same role, when there's more than one. */
  postings: Job[] | null;
  stale: string[] | null;
  source: string;
  isNew?: boolean;
  yours?: boolean;
  expanded?: boolean;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onExpand: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { job, postings, stale, source, status } = p;
  const places = postings
    ? placeSummary(postings.flatMap((j) => (j.cities.length ? j.cities : j.location ? [cleanLocation(j.location)] : [])))
    : placeSummary(job.cities.length ? job.cities : job.location ? [cleanLocation(job.location)] : []);
  const age = timeAgo(postedOrSeen(job)).replace(/ ago$/, "");
  const workplace = workplaceBeside(places, WORKPLACE_LABEL[job.workplace]);
  const evergreen = evergreenReason(job);
  // Under the title, one line: where the job is, then how fresh it is (seniority and type are pills below).
  const metaLine: ReactNode[] = [
    <span key="places" className="text-ink">
      {places}
    </span>,
    ...(workplace
      ? [
          <span key="workplace" className="text-ink">
            {workplace}
          </span>,
        ]
      : []),
    // The stale callout says how old it is: this line keeps the plain age then.
    isOlder(job) && job.status === "open" && !stale ? (
      <span key="older" className="text-warning-text" title="Most roles are filled within two months. It's still listed, but may no longer be hiring.">
        {job.postedAt ? "Posted" : "First seen"} {age} ago, may be filled
      </span>
    ) : (
      <span key="age" title={job.postedAt ? `Posted ${formatDate(job.postedAt)}` : `First seen ${formatDate(job.firstSeen)}`}>
        {job.postedAt ? "Posted" : "First seen"} {age} ago
      </span>
    ),
    // We read it off the company's own board: say when, so "is this still open?" has an answer.
    ...(job.status === "closed"
      ? [
          <span key="closed" className="text-danger-text">
            Closed{job.closedAt ? ` ${formatDate(job.closedAt)}` : ""}
          </span>,
        ]
      : job.estimated
        ? []
        : // Not rechecked for days (its board failed, or bot protection turned scans away): it may have closed meanwhile.
          Date.now() - Date.parse(job.lastSeen) > RECHECK_DAYS * 86_400_000
          ? [
              <span key="checked" className="text-warning-text" title="RawJobs hasn't confirmed this job on the company's board lately, so it may have closed since.">
                listed on {source}, last checked {timeAgo(job.lastSeen)}, may be outdated
              </span>,
            ]
          : [`listed on ${source}, checked ${timeAgo(job.lastSeen)}`]),
    ...(evergreen === "pool"
      ? [
          <span key="pool" className="text-warning-text" title="A talent pool or open application: it collects applications rather than filling one role">
            Talent pool
          </span>,
        ]
      : []),
    ...(evergreen === "reposted" && !stale
      ? [
          <span key="reposted" className="text-warning-text" title={`Taken down and posted again on ${formatDate(job.repostedAt)}: dated from the first posting`}>
            Reposted
          </span>,
        ]
      : []),
  ];
  return (
    <header className="rj-drawer__head">
      <div className="rj-drawer__top">
        <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
          {p.isNew && <span className="rj-dot" role="img" aria-label="New this scan" />}
          <span className="truncate">{companyName(job.company)}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {p.onClose && (
            <IconButton label="Back" title="Back (Esc)" aria-keyshortcuts="Escape" size="sm" onClick={p.onClose} className={p.expanded ? "hidden" : "lg:hidden"}>
              <ArrowLeft className="rj-icon" />
            </IconButton>
          )}
          {p.onPrev && (
            <IconButton label="Previous job" shortcut="K" size="sm" onClick={p.onPrev}>
              <ChevronUp className="rj-icon" />
            </IconButton>
          )}
          {p.onNext && (
            <IconButton label="Next job" shortcut="J" size="sm" onClick={p.onNext}>
              <ChevronDown className="rj-icon" />
            </IconButton>
          )}
          {/* Phones already show the job full screen. */}
          {!p.expanded && (
            <IconButton label="Expand to full window" shortcut="F" size="sm" onClick={p.onExpand} className="max-md:hidden">
              <Maximize2 className="rj-icon" />
            </IconButton>
          )}
          {p.onClose && (
            <IconButton label="Close" title="Close (Esc)" aria-keyshortcuts="Escape" size="sm" onClick={p.onClose} className={p.expanded ? undefined : "hidden lg:inline-flex"}>
              <X className="rj-icon" />
            </IconButton>
          )}
        </div>
      </div>
      <h2 className="rj-drawer__title">
        {p.yours && <Star className="rj-star" role="img" aria-label="My company" />}
        <span className="min-w-0">{jobTitle(job.title)}</span>
      </h2>
      <MetaLine className="rj-drawer__meta" parts={metaLine} />
      {status !== "dismissed" && <PeopleYouKnow job={job} scrollRef={p.scrollRef} />}
    </header>
  );
}
