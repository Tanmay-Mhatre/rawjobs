import { useMemo } from "react";
import type { Job, Profile } from "../../lib/data";
import { type Ctx, hasNewTag, sortJobs } from "../../lib/filters";
import { identityOf, roleOf } from "../../lib/identity";
import type { EntryPatch, UserState } from "../../lib/userState";
import { ErrorBoundary } from "../ErrorBoundary";
import { JobDetail } from "../JobDetail";
import { toast } from "../Toast";
import { Card } from "../ui";
import { useStableHandler } from "./hooks";

/**
 * Laptops and up: the current job's details beside the list. JobDetail is memo, so every handler here stays the
 * same function across renders and calls the latest props.
 */
export function RadarDetail(p: {
  selected: Job | undefined;
  /** The current role's postings (one per place). */
  postings: Job[];
  ctx: Ctx;
  jobs: Job[];
  user: UserState;
  profile: Profile;
  industriesByCompany: ReadonlyMap<string, string[]>;
  hidden: ReadonlySet<string>;
  isYours: (j: Job) => boolean;
  indexGeneratedAt?: string;
  hasPrev: boolean;
  hasNext: boolean;
  move: (d: number) => void;
  onOpenJob: (j: Job) => void;
  onUpdate: (job: Job, patch: EntryPatch) => void;
  onApply: (job: Job) => void;
  onHideCompany: (company: string, hidden: boolean) => void;
  onTrack?: (job: Job, on: boolean) => Promise<string | null>;
  onCheck?: (job: Job) => Promise<string | null>;
}) {
  const { selected } = p;
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
  const onDetailUpdate = useStableHandler((patch: EntryPatch) => {
    if (selected) p.onUpdate(selected, patch);
  });
  const onDetailHide = useStableHandler((h: boolean) => {
    if (selected) hideCompany(selected.company, h);
  });
  const onDetailTrack = useStableHandler((on: boolean) => (selected && p.onTrack ? p.onTrack(selected, on) : Promise.resolve(null)));
  const onDetailCheck = useStableHandler(() => (selected && p.onCheck ? p.onCheck(selected) : Promise.resolve(null)));
  const onDetailApply = useStableHandler(p.onApply);
  const onDetailPrev = useStableHandler(() => p.move(-1));
  const onDetailNext = useStableHandler(() => p.move(1));

  const moreFromCompany = useMemo(
    () =>
      selected
        ? sortJobs(
            p.jobs.filter((j) => identityOf(j) === identityOf(selected) && roleOf(j) !== roleOf(selected) && j.status === "open"),
            "best",
          ).slice(0, 5)
        : [],
    [p.jobs, selected],
  );

  return (
    <Card className="hidden overflow-hidden lg:block lg:h-full lg:min-h-0">
      {/* A crash in the details keeps the list; picking another job starts it afresh. */}
      {selected ? (
        <ErrorBoundary key={selected.id} where="this job">
          <JobDetail
            job={selected}
            isNew={hasNewTag(selected, p.ctx)}
            entry={p.user[selected.id]}
            profile={p.profile}
            postings={p.postings}
            industries={p.industriesByCompany.get(selected.company)}
            moreFromCompany={moreFromCompany}
            yours={p.isYours(selected)}
            indexGeneratedAt={p.indexGeneratedAt}
            onTrack={p.onTrack && onDetailTrack}
            onCheck={p.onCheck && selected.estimated ? onDetailCheck : undefined}
            companyHidden={p.hidden.has(selected.company)}
            onUpdate={onDetailUpdate}
            onApply={onDetailApply}
            onHideCompany={onDetailHide}
            onOpenJob={p.onOpenJob}
            onPrev={p.hasPrev ? onDetailPrev : undefined}
            onNext={p.hasNext ? onDetailNext : undefined}
          />
        </ErrorBoundary>
      ) : (
        <p className="p-6 type-small text-muted">Pick a job to see the details.</p>
      )}
    </Card>
  );
}
