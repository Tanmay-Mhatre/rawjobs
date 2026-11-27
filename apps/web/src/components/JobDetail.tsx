import { isRoleStale, staleReasons } from "../lib/stale";
import { atsLabel } from "../lib/filters";
import { copyText } from "../lib/clipboard";
import { useDescription, useHiring, type Job, type Profile } from "../lib/data";
import { companyName, jobTitle } from "../lib/format";
import type { ClosedAs, Entry, EntryPatch, Status } from "../lib/userState";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { hiringLine } from "./HiringActivity";
import { AboutCompany } from "./job/AboutCompany";
import { DescriptionSection } from "./job/Description";
import { JobActions } from "./job/JobActions";
import { JobFacts } from "./job/JobFacts";
import { JobHeader } from "./job/JobHeader";
import { NotCheckedYet } from "./job/NotCheckedYet";
import { NotesField, YourProgress } from "./job/Progress";
import { WhyItMatches } from "./job/WhyItMatches";
import { useNotForMe } from "./NotForMe";
import { toast } from "./Toast";
import { ConnectBanner } from "./referral/ConnectBanner";
import { TalkToSomeone } from "./referral/TalkToSomeone";
import { cx } from "./ui";

export type JobDetailProps = {
  job: Job;
  entry?: Entry;
  profile: Profile;
  /** Other postings of the same role (grouped duplicates), including `job`. */
  postings?: Job[];
  industries?: string[];
  moreFromCompany?: Job[];
  companyHidden?: boolean;
  onUpdate: (patch: EntryPatch) => void;
  onApply?: (job: Job) => void;
  onHideCompany?: (hidden: boolean) => void;
  onOpenJob?: (job: Job) => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Shown as an overlay (phones, Pipeline): a close / back button. */
  onClose?: () => void;
  /** The job is at one of your companies. */
  yours?: boolean;
  /** New this scan: the source tag shows the new dot. */
  isNew?: boolean;
  /** When the directory index behind an estimated job was built. */
  indexGeneratedAt?: string;
  /** Add or remove the job's company from your companies. Resolves to an error, or null. */
  onTrack?: (on: boolean) => Promise<string | null>;
  /** Check an estimated job's company live now. Resolves to an error, or null. */
  onCheck?: () => Promise<string | null>;
  /** Shown in the full-window reader (Expand): no Expand button, and F closes it. */
  expanded?: boolean;
};

/** Everything about one job (design/components/Drawer): head with source, title and meta; body with the score, status, description and details; foot with the actions. */
export const JobDetail = memo(function JobDetail(p: JobDetailProps) {
  const { job, entry, profile } = p;
  const description = useDescription(job);
  const hiringData = useHiring(job);
  // Only with a count to say: "records started…" alone tells you nothing about the company.
  const hiring = hiringData && hiringLine(hiringData) ? hiringData : null;
  const [copied, setCopied] = useState(false);
  /** The full-window reader, for reading the whole description in one view. */
  const [expanded, setExpanded] = useState(false);
  /** The description past its preview, in place. */
  const [fullText, setFullText] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const status = entry?.status;
  /** On the board (any stage, Closed too): the progress tabs show. */
  const tracked = !!status && status !== "dismissed";
  /** "On this job: Messaged" in the referral section asked for the People tab (a new count reopens it). */
  const [peopleAsk, setPeopleAsk] = useState<{ jobId: string; n: number } | null>(null);
  const openPeople = peopleAsk?.jobId === job.id ? peopleAsk.n : 0;
  const notForMe = useNotForMe();
  const source = atsLabel(job.ats);

  // biome-ignore lint/correctness/useExhaustiveDependencies: another job opened: scroll back to the top and reset
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setCopied(false);
    setFullText(false);
  }, [job.id]);

  const copyJd = async () => {
    if (!description) return;
    const text = [`${job.title}, ${job.company}`, job.location, job.url, "", description].join("\n");
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // The shortcuts below call the latest handlers: a new job or `expanded` doesn't re-add the listener.
  const onShortcut = useEffectEvent((key: "c" | "f") => {
    if (key === "c") void copyJd();
    else if (p.expanded) p.onClose?.();
    else setExpanded(true);
  });

  // C copies the description and F expands it (or closes the reader), like the hints on the buttons. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "c" && e.key !== "f") || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      // Not while some other dialog (Settings, the "Did you apply?" prompt) is on top of this job.
      const dialog = [...document.querySelectorAll("dialog[open]")].pop();
      if (dialog && !dialog.contains(rootRef.current)) return;
      onShortcut(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const postings = p.postings && p.postings.length > 1 ? p.postings : null;
  // The loaded description counts too, for data written before descriptionLength existed.
  const staleCtx = { descriptionLength: description ? description.trim().length : undefined };
  // The callout is for the role: one fresh posting of it and it's still live (the stale ones are marked in the list).
  const stale = isRoleStale(postings ?? [job], (j) => (j.id === job.id ? staleCtx : undefined)) ? staleReasons(job, staleCtx) : null;
  // Add or remove the company from My companies; an error comes back as a toast.
  const track = async () => {
    const error = await p.onTrack?.(!p.yours);
    if (error) toast({ message: error });
  };
  const setStatus = (next: Status | undefined) => {
    p.onUpdate({ status: next });
    // Beside the list the job leaves at once, so the reasons go in a toast; in a drawer they're right below.
    if (next === "dismissed" && !p.onClose) notForMe?.askWhy(job, status);
  };
  /** The progress dropdown's value: a status, or "rejected:<how it ended>". */
  const setProgress = (value: string) => {
    const [next, closedAs] = value.split(":") as [Status | "", ClosedAs | undefined];
    if (next === "rejected") p.onUpdate({ status: "rejected", closedAs: closedAs ?? "rejected" });
    else setStatus(next || undefined);
  };

  const descriptionSection = <DescriptionSection job={job} description={description} expanded={p.expanded} fullText={fullText} onFullText={() => setFullText(true)} />;

  return (
    <section ref={rootRef} aria-label="Job details" className="flex h-full min-h-0 flex-col">
      {/* Picking another job changes this panel without moving focus: say so to screen readers. */}
      <p className="sr-only" aria-live="polite">
        Showing {jobTitle(job.title)} at {companyName(job.company)}
      </p>
      <JobHeader
        job={job}
        status={status}
        postings={postings}
        stale={stale}
        source={source}
        isNew={p.isNew}
        yours={p.yours}
        expanded={p.expanded}
        onClose={p.onClose}
        onPrev={p.onPrev}
        onNext={p.onNext}
        onExpand={() => setExpanded(true)}
        scrollRef={scrollRef}
      />

      <div ref={scrollRef} className={cx("rj-drawer__body min-h-0 flex-1", p.expanded && "md:grid-cols-[minmax(0,1fr)_20rem] md:gap-x-10")}>
        {/* Expanded: the description gets the wide column, everything else sits beside it. */}
        {p.expanded && descriptionSection}
        {/* Sections in the order you decide: fit, the facts, who can get you in, the role, your progress, the company. */}
        <div className={cx("rj-drawer__stack grid min-w-0 grid-cols-1 content-start gap-6", p.expanded && "md:col-start-2 md:row-start-1")}>
          <ConnectBanner job={job} notInterested={status === "dismissed"} />

          {stale && (
            <aside aria-label="May be stale" className="grid gap-1 rounded-md bg-warning-subtle p-3 type-small text-warning-text">
              <h3 className="font-semibold text-warning-text">May be stale</h3>
              <ul className="list-disc space-y-1 pl-5">
                {stale.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p>It's still on the company's board, so it may be real. Worth asking a recruiter before spending time on it.</p>
            </aside>
          )}

          <WhyItMatches job={job} profile={profile} yours={!!p.yours} />

          {!job.estimated && <JobFacts job={job} postings={postings} hiringData={hiringData} industries={p.industries} source={source} />}

          <TalkToSomeone job={job} entry={entry} profile={profile} onUpdate={p.onUpdate} onOpenPeople={() => setPeopleAsk((x) => ({ jobId: job.id, n: (x?.n ?? 0) + 1 }))} />

          {job.estimated && <NotCheckedYet indexGeneratedAt={p.indexGeneratedAt} onCheck={p.onCheck} />}

          {!p.expanded && descriptionSection}

          {/* Not tracked yet: just a note. Save (S) in the foot puts it on the board, and the progress row shows. */}
          {!tracked && status !== "dismissed" && <NotesField key={job.id} id={`notes-${job.id}`} note={entry?.note ?? ""} onSave={(note) => p.onUpdate({ note: note || undefined })} />}

          {(tracked || status === "dismissed") && <YourProgress job={job} entry={entry} tracked={tracked} openPeople={openPeople} onUpdate={p.onUpdate} onProgress={setProgress} />}

          <AboutCompany job={job} hiring={hiring} postings={postings} staleCtx={staleCtx} moreFromCompany={p.moreFromCompany} onOpenJob={p.onOpenJob} onApply={p.onApply} />
        </div>
      </div>

      <JobActions
        job={job}
        status={status}
        source={source}
        canCopy={!!job.hasDescription && !!description}
        copied={copied}
        onCopy={() => void copyJd()}
        onUpdate={p.onUpdate}
        setStatus={setStatus}
        onApply={p.onApply}
        onHideCompany={p.onHideCompany}
        companyHidden={p.companyHidden}
        onTrack={p.onTrack && (() => void track())}
        yours={p.yours}
      />

      {expanded && !p.expanded && (
        <Dialog open onClose={() => setExpanded(false)} label={job.title} className="h-[calc(100dvh-3rem)] sm:max-w-4xl">
          <div className="h-full w-full overflow-hidden rounded-md border border-line bg-raised shadow-l3">
            <JobDetail {...p} expanded onClose={() => setExpanded(false)} />
          </div>
        </Dialog>
      )}
    </section>
  );
});
