import { fromJobBoard } from "@rawjobs/core/dashboard";
import { safeUrl } from "@rawjobs/core/text";
import { ExternalLink } from "lucide-react";
import type { Job } from "../../lib/data";
import { companyName } from "../../lib/format";
import { atsLabel } from "../../lib/filters";
import { isStale, staleReasons } from "../../lib/stale";
import { HiringActivity } from "../HiringActivity";
import { cx } from "../ui";
import type { HiringSummary } from "@rawjobs/core/activity";

/** The company, in one section: how fast it's hiring, this role's other postings, and more jobs there. */
export function AboutCompany(p: {
  job: Job;
  hiring: HiringSummary | null;
  /** Other postings of the same role, when there's more than one. */
  postings: Job[] | null;
  /** What's known about the open posting beyond the job itself (its loaded description), for "may be stale". */
  staleCtx: { descriptionLength?: number };
  moreFromCompany?: Job[];
  onOpenJob?: (job: Job) => void;
  onApply?: (job: Job) => void;
}) {
  const { job, hiring, postings, staleCtx } = p;
  if (!(hiring || postings || !!p.moreFromCompany?.length)) return null;
  // A job board's copy of the role is a posting, not another place.
  const placeCount = postings ? new Set(postings.map((j) => j.location || "Location not listed")).size : 0;
  return (
    <section className="rj-drawer__section gap-4" aria-labelledby={`company-${job.id}`}>
      <h3 id={`company-${job.id}`} className="rj-sec-h">
        About {companyName(job.company)}
      </h3>
      {hiring && <HiringActivity summary={hiring} />}

      {postings && (
        <div className="grid gap-2">
          <h4 className="rj-sub-h">{placeCount > 1 ? `Posted in ${placeCount} locations` : `Posted ${postings.length} times`}</h4>
          <ul className="divide-y divide-line rounded-md border border-line">
            {postings.map((j) => {
              const ctx = j.id === job.id ? staleCtx : undefined;
              return (
                <li key={j.id} className={cx("flex items-center gap-2 px-3 py-2 type-small", j.id === job.id && "bg-active")}>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => p.onOpenJob?.(j)} aria-current={j.id === job.id || undefined}>
                    {j.location || "Location not listed"}
                    {fromJobBoard(j) && <span className="text-muted"> · via {atsLabel(j.ats)}</span>}
                  </button>
                  {/* The role may be live while this posting of it isn't. */}
                  {isStale(j, ctx) && (
                    <span className="shrink-0 text-warning-text" title={staleReasons(j, ctx)[0]}>
                      may be stale
                    </span>
                  )}
                  <span className="tabular text-muted">{j.score}</span>
                  <a href={safeUrl(j.url)} target="_blank" rel="noreferrer" onClick={() => p.onApply?.(j)} className="text-muted hover:text-ink" aria-label={`Open the ${j.location} posting`}>
                    <ExternalLink className="rj-icon" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Only when there's something to show; hiding the company is in More. */}
      {!!p.moreFromCompany?.length && (
        <div className="grid gap-2">
          <h4 className="rj-sub-h">More from {companyName(job.company)}</h4>
          <ul className="divide-y divide-line rounded-md border border-line">
            {p.moreFromCompany.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => p.onOpenJob?.(j)} className="flex w-full items-center gap-3 px-3 py-2 text-left type-small hover:bg-hover">
                  <span className="tabular w-7 shrink-0 font-semibold text-muted">{j.score}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{j.title}</span>
                    <span className="block truncate text-muted">{j.location}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
