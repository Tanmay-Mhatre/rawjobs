import { EMPLOYMENT_LABEL } from "@rawjobs/core/catalog/employment";
import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { SENIORITY_LEVELS } from "@rawjobs/core/catalog/seniority";
import { fromJobBoard } from "@rawjobs/core/dashboard";
import { sponsorOf, sponsorSentence, sponsorTitle, VISA_REGISTERS } from "@rawjobs/core/catalog/visa";
import { matchesTitle, safeUrl } from "@rawjobs/core/text";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Info,
  LoaderCircle,
  Maximize2,
  Plus,
  RefreshCw,
  Star,
  StickyNote,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { useDescription, useHiring, type Job, type Profile } from "../lib/data";
import { cleanLocation, companyName, eligibilityNotes, formatDate, formatSalary, jobTitle, placeSummary, postedOrSeen, timeAgo, workplaceBeside } from "../lib/format";
import { atsLabel, evergreenReason, INDEX_MAX_AGE_DAYS, isOlder } from "../lib/filters";
import { isRoleStale, isStale, staleReasons } from "../lib/stale";
import { type FitFix, fitFixes, fixApplied, useProfileFix } from "../lib/profileFix";
import { load, save } from "../lib/storage";
import { CLOSED_AS, type ClosedAs, type Entry, type EntryPatch, dayAfter, followUpDue, isActive, PIPELINE, quickStatus, STATUS_LABEL, type Status, stageSince, statusLabel } from "../lib/userState";
import { Dialog } from "./Dialog";
import { settingsHash } from "./settings/registry";
import { HiringActivity } from "./HiringActivity";
import { ReasonPicker, useNotForMe } from "./NotForMe";
import { Button, buttonClass, IconButton, Menu, ScoreBadge, scoreBandOf, ScoreBreakdown, scoreParts, Tooltip } from "./primitives";
import { toast } from "./Toast";
import { JobTracking } from "./pipeline/JobTracking";
import { TalkToSomeone } from "./referral/TalkToSomeone";
import { OfferFields } from "./TrackedJob";
import { cx, Select } from "./ui";

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

const SENIORITY_LABEL = Object.fromEntries(SENIORITY_LEVELS.map((s) => [s.id, s.label]));
const WORKPLACE_LABEL: Record<Job["workplace"], string | null> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote", unknown: null };
const BAND_WORD = { strong: "Strong", fair: "Fair", weak: "Weak" } as const;
/** Descriptions longer than this start as a preview. */
const PREVIEW_CHARS = 900;

/** Plain text pieces joined by the kit's " · " separator. */
function MetaLine({ parts, className }: { parts: ReactNode[]; className?: string }) {
  return (
    <p className={className}>
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
        <Fragment key={i}>
          {i > 0 && (
            <span className="rj-sep" aria-hidden>
              ·
            </span>
          )}
          {/* Each part wraps as a whole ("Copperkettle Pay" never splits across lines) unless it's wider than the line. */}
          <span className="inline-block max-w-full">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

type Fact = { label: string; value: ReactNode; note?: string; muted?: boolean; tone?: "warn" | "good" };

/** The decision facts as a grid of small boxes: label, value, and where the value came from. */
function KeyFacts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="rj-facts">
      {facts.map((f) => (
        <div key={f.label} className="rj-fact">
          <dt>{f.label}</dt>
          <dd className={cx(f.muted && "!text-muted", f.tone === "warn" && "!text-warning-text", f.tone === "good" && "!text-success-text")}>{f.value}</dd>
          {f.note && <dd className="rj-fact__note">{f.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Everything about one job (design/components/Drawer): head with source, title and meta; body with the score, status, description and details; foot with the actions. */
export function JobDetail(p: JobDetailProps) {
  const { job, entry, profile } = p;
  const description = useDescription(job);
  const hiring = useHiring(job);
  const [copied, setCopied] = useState(false);
  /** The full-window reader, for reading the whole description in one view. */
  const [expanded, setExpanded] = useState(false);
  /** The description past its preview, in place. */
  const [fullText, setFullText] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const salary = formatSalary(job.salary);
  const status = entry?.status;
  /** On the board (any stage, Closed too): the progress tabs show. */
  const tracked = !!status && status !== "dismissed";
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
  const copyRef = useRef(copyJd);
  copyRef.current = copyJd;

  const expandRef = useRef(() => (p.expanded ? p.onClose?.() : setExpanded(true)));
  expandRef.current = () => (p.expanded ? p.onClose?.() : setExpanded(true));

  // C copies the description and F expands it (or closes the reader), like the hints on the buttons. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "c" && e.key !== "f") || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      // Not while some other dialog (Settings, the "Did you apply?" prompt) is on top of this job.
      const dialog = [...document.querySelectorAll("dialog[open]")].pop();
      if (dialog && !dialog.contains(rootRef.current)) return;
      if (e.key === "f") expandRef.current();
      else void copyRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const postings = p.postings && p.postings.length > 1 ? p.postings : null;
  // A job board's copy of the role is a posting, not another place.
  const placeCount = postings ? new Set(postings.map((j) => j.location || "Location not listed")).size : 0;
  const places = postings
    ? placeSummary(postings.flatMap((j) => (j.cities.length ? j.cities : j.location ? [cleanLocation(j.location)] : [])))
    : placeSummary(job.cities.length ? job.cities : job.location ? [cleanLocation(job.location)] : []);
  const age = timeAgo(postedOrSeen(job)).replace(/ ago$/, "");
  const workplace = workplaceBeside(places, WORKPLACE_LABEL[job.workplace]);
  const evergreen = evergreenReason(job);
  // On a government list of visa sponsors for the job's country (any of the role's places).
  const sponsor = sponsorOf(postings ?? [job]);
  // The loaded description counts too, for data written before descriptionLength existed.
  const staleCtx = { descriptionLength: description ? description.trim().length : undefined };
  // The callout is for the role: one fresh posting of it and it's still live (the stale ones are marked in the list).
  const stale = isRoleStale(postings ?? [job], (j) => (j.id === job.id ? staleCtx : undefined)) ? staleReasons(job, staleCtx) : null;
  // A register listing ("Sponsors visas") already says it: the posting's own "we sponsor" would repeat it.
  const eligibility = eligibilityNotes(job.eligibility).filter((n) => !(sponsor && n.text === "Sponsors a visa"));
  // Under the title: where and what the job is, then how fresh it is.
  const factsLine: ReactNode[] = [places, ...(workplace ? [workplace] : []), ...(job.employmentType ? [EMPLOYMENT_LABEL[job.employmentType]] : []), SENIORITY_LABEL[job.seniority]];
  const freshLine: ReactNode[] = [
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
            Closed
          </span>,
        ]
      : job.estimated
        ? []
        : [`still listed, checked ${timeAgo(job.lastSeen)}`]),
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
  const limits = eligibility.filter((n) => n.limit);
  // "EU only" is read from the title or location, "UAE nationals only" from either the title or the description, the rest from the description.
  const fromTitle = (n: { text: string }) => n.text === `${job.eligibility?.regionOnly} only`;
  const limitsFrom = limits.every(fromTitle)
    ? "From the title or location"
    : job.eligibility?.nationalsOnly && limits.some((n) => n.text.endsWith("nationals only"))
      ? "From the posting"
      : "From the description";
  const pluses = [...(sponsor ? ["Sponsors visas"] : []), ...eligibility.filter((n) => !n.limit).map((n) => n.text)];
  const last30 = hiring?.last30 ?? job.surge?.n;
  const usual = hiring?.usual ?? job.surge?.usual;
  const surge = hiring ? hiring.surge : !!job.surge;
  // The decisions a job seeker makes first, each saying where its answer came from (or that there's none).
  const facts: Fact[] = [
    salary
      ? { label: "Salary", value: salary, note: job.salaryFrom === "description" ? "Read from the description" : "From the posting" }
      : { label: "Salary", value: "Not listed", muted: true, note: job.hasDescription ? "Not in the posting or description" : "Not in the posting" },
    WORKPLACE_LABEL[job.workplace] ? { label: "Work mode", value: WORKPLACE_LABEL[job.workplace] } : { label: "Work mode", value: "Not stated", muted: true, note: "No on-site or remote wording" },
    { label: "Seniority", value: SENIORITY_LABEL[job.seniority], note: "Read from the title" },
    limits.length
      ? { label: "Who can apply", value: limits.map((n) => n.text).join(", "), tone: "warn", note: pluses.join(", ") || limitsFrom }
      : pluses.length
        ? { label: "Who can apply", value: pluses.join(", "), tone: "good", note: sponsor ? sponsorTitle(sponsor) : "From the description" }
        : { label: "Who can apply", value: "No limits stated", muted: true, note: "Visa, residency, relocation not mentioned" },
    last30 !== undefined
      ? {
          label: "Company hiring",
          value: `${last30} ${last30 === 1 ? "role" : "roles"} in 30 days`,
          tone: surge ? "good" : undefined,
          note: surge ? "Hiring surge: far more than usual" : usual !== undefined ? `Usually about ${Math.round(usual)}` : undefined,
        }
      : { label: "Company hiring", value: "Not known yet", muted: true },
    job.employmentType ? { label: "Type", value: EMPLOYMENT_LABEL[job.employmentType], note: `Via ${source}` } : { label: "Type", value: "Not stated", muted: true, note: `Via ${source}` },
  ];
  const saved = status === "saved";
  // Further along than Saved (Applied, Interviewing…): Save shows where it is and doesn't move it back.
  const further = !!status && quickStatus(status, "saved") === null;
  const saveLabel = further && status ? STATUS_LABEL[status] : saved ? "Saved" : "Save";
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

  const preview = !p.expanded && !fullText && (description?.length ?? 0) > PREVIEW_CHARS;
  const descriptionSection = (
    <section className="rj-drawer__section">
      <h3 className="rj-h">About the role</h3>
      {description === undefined ? (
        <p className="flex items-center gap-2 type-small text-muted">
          <LoaderCircle className="size-4 animate-spin" /> Loading…
        </p>
      ) : description ? (
        // A long description starts as a preview beside the list; the reader (F) always shows it all.
        preview ? (
          <>
            <div className="rj-preview">
              <Highlighted text={description} terms={job.why.keywords} wide={p.expanded} />
            </div>
            <Button size="sm" variant="quiet" className="justify-self-start" onClick={() => setFullText(true)}>
              Read full description
            </Button>
          </>
        ) : (
          <Highlighted text={description} terms={job.why.keywords} wide={p.expanded} />
        )
      ) : (
        <p className="type-small text-muted">
          {job.estimated ? "Not scanned yet, so no description." : job.why.gate ? "Not stored for jobs that fail your filters." : "The hiring system didn't include a description."} Open the job page
          to read it.
        </p>
      )}
    </section>
  );

  return (
    <section ref={rootRef} aria-label="Job details" className="flex h-full min-h-0 flex-col">
      {/* Picking another job changes this panel without moving focus: say so to screen readers. */}
      <p className="sr-only" aria-live="polite">
        Showing {jobTitle(job.title)} at {companyName(job.company)}
      </p>
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
              <IconButton label="Expand to full window" shortcut="F" size="sm" onClick={() => setExpanded(true)} className="max-md:hidden">
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
        <MetaLine className="rj-drawer__meta !text-ink" parts={factsLine} />
        <MetaLine className="rj-drawer__meta" parts={freshLine} />
      </header>

      <div ref={scrollRef} className={cx("rj-drawer__body min-h-0 flex-1", p.expanded && "md:grid-cols-[minmax(0,1fr)_20rem] md:gap-x-10")}>
        {/* Expanded: the description gets the wide column, everything else sits beside it. */}
        {p.expanded && descriptionSection}
        <div className={cx("grid min-w-0 grid-cols-1 content-start gap-6", p.expanded && "md:col-start-2 md:row-start-1")}>
          {stale && (
            <section className="rj-drawer__section">
              <h3 className="rj-h text-warning-text">May be stale</h3>
              <ul className="list-disc space-y-1 pl-5 type-small">
                {stale.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="type-small text-muted">It's still on the company's board, so it may be real. Worth asking a recruiter before spending time on it.</p>
            </section>
          )}

          {!job.estimated && <KeyFacts facts={facts} />}

          <WhyItMatches job={job} profile={profile} yours={!!p.yours} />

          <TalkToSomeone job={job} entry={entry} profile={profile} />

          {job.estimated && <NotCheckedYet indexGeneratedAt={p.indexGeneratedAt} onCheck={p.onCheck} />}

          {!p.expanded && descriptionSection}

          <section className="rj-drawer__section border-t border-line pt-4">
            {/* The one place to set any status; Save and Not interested in the foot are shortcuts. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label htmlFor={`status-${job.id}`} className="font-medium text-ink">
                Your progress
              </label>
              <Select id={`status-${job.id}`} value={progressValue(entry)} onChange={(e) => setProgress(e.target.value)}>
                <option value="">Not tracked</option>
                {PIPELINE.filter((s) => s !== "rejected").map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
                {(Object.keys(CLOSED_AS) as ClosedAs[]).map((c) => (
                  <option key={c} value={`rejected:${c}`}>
                    Closed: {CLOSED_AS[c].toLowerCase()}
                  </option>
                ))}
                <option value="dismissed">{STATUS_LABEL.dismissed}</option>
              </Select>
              {/* Tracked: notes are logged in Activity (an older note shows there too). */}
              {!tracked && <NotesField key={job.id} id={`notes-${job.id}`} note={entry?.note ?? ""} onSave={(note) => p.onUpdate({ note: note || undefined })} />}
              <CvField key={`cv:${job.id}`} id={`cv-${job.id}`} cv={entry?.cv ?? ""} onSave={(cv) => p.onUpdate({ cv: cv || undefined })} />
            </div>
            {entry && <ProgressLine entry={entry} onUpdate={p.onUpdate} id={`follow-${job.id}`} />}
            {tracked && entry && (entry.status === "offer" || entry.offer) && <OfferFields key={`offer:${job.id}`} offer={entry.offer ?? {}} onSave={(offer) => p.onUpdate({ offer })} />}
            {tracked && entry && <JobTracking jobId={job.id} entry={entry} title={job.title} foundAt={job.firstSeen} onUpdate={p.onUpdate} />}
            {status === "dismissed" && <ReasonPicker key={`why:${job.id}`} job={job} label="Why not? Optional." live />}
          </section>

          {sponsor && (
            <section className="rj-drawer__section">
              <h3 className="rj-h text-success-text">Sponsors visas</h3>
              <p className="type-small">{sponsorSentence(companyName(job.company), sponsor)}</p>
              <p className="type-small text-muted">That means it can sponsor, not that this role will. Source: {VISA_REGISTERS[sponsor.country].source}.</p>
            </section>
          )}

          {postings && (
            <section className="rj-drawer__section">
              <h3 className="rj-h">{placeCount > 1 ? `Posted in ${placeCount} locations` : `Posted ${postings.length} times`}</h3>
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
            </section>
          )}

          <section className="rj-drawer__section">
            <h3 className="rj-h">Details</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-small">
              <dt className="text-muted">Posted</dt>
              <dd className="text-muted">{job.postedAt ? `${formatDate(job.postedAt)} (${timeAgo(job.postedAt)})` : "Not given by the hiring system"}</dd>
              <dt className="text-muted">First seen</dt>
              <dd className="text-muted">{formatDate(job.firstSeen)}</dd>
              <dt className="text-muted">Last seen</dt>
              <dd className="text-muted">{timeAgo(job.lastSeen)}</dd>
              {job.status === "closed" && job.closedAt && (
                <>
                  <dt className="text-muted">Closed</dt>
                  <dd className="text-muted">{formatDate(job.closedAt)}</dd>
                </>
              )}
              {job.department && (
                <>
                  <dt className="text-muted">Department</dt>
                  <dd>{job.department}</dd>
                </>
              )}
              {p.industries?.length ? (
                <>
                  <dt className="text-muted">Industry</dt>
                  <dd>{p.industries.map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i).join(", ")}</dd>
                </>
              ) : null}
              <dt className="text-muted">Hiring system</dt>
              <dd>{source}</dd>
            </dl>
          </section>

          {hiring && <HiringActivity company={companyName(job.company)} summary={hiring} />}

          {(p.moreFromCompany?.length || p.onHideCompany) && (
            <section className="rj-drawer__section">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="rj-h">More from {companyName(job.company)}</h3>
                {p.onHideCompany && (
                  <button type="button" className="type-small text-muted hover:text-danger-text" onClick={() => p.onHideCompany!(!p.companyHidden)}>
                    {p.companyHidden ? "Show this company again" : "Hide this company"}
                  </button>
                )}
              </div>
              {p.moreFromCompany?.length ? (
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
              ) : (
                <p className="type-small text-muted">No other matching jobs here right now.</p>
              )}
            </section>
          )}
        </div>
      </div>

      <footer className="rj-drawer__foot">
        <a
          href={safeUrl(job.url)}
          target="_blank"
          rel="noreferrer"
          onClick={() => p.onApply?.(job)}
          className={buttonClass("primary", "md", "rj-foot__apply")}
          title={job.estimated ? undefined : `Apply at ${companyName(job.company)}, opens the posting on ${source}`}
        >
          <ExternalLink className="rj-icon" />
          {/* A long company name ends in "…" rather than pushing the other actions to a second row. */}
          <span className="truncate">{job.estimated ? "Open careers page" : `Apply at ${companyName(job.company)}`}</span>
        </a>
        {/* Labelled on phones; on wider screens an icon with a tooltip (rj-foot__act), named by aria-label either way. */}
        <Button
          icon={saved || further ? <BookmarkCheck className="rj-icon" /> : <Bookmark className="rj-icon" />}
          shortcut="S"
          onClick={() => {
            const next = quickStatus(status, "saved");
            if (next !== null) p.onUpdate({ status: next });
          }}
          aria-pressed={saved || further}
          aria-label={saveLabel}
          className="rj-foot__act aria-pressed:border-ink aria-pressed:bg-active"
        >
          <span className="rj-foot__text">{saveLabel}</span>
          <Tooltip label={saveLabel} shortcut="S" side="above" />
        </Button>
        <Button
          icon={<X className="rj-icon" />}
          shortcut="X"
          onClick={() => setStatus(status === "dismissed" ? undefined : "dismissed")}
          aria-pressed={status === "dismissed"}
          aria-label="Not interested"
          className="rj-foot__act aria-pressed:border-ink aria-pressed:bg-active"
        >
          <span className="rj-foot__text">Not interested</span>
          <Tooltip label="Not interested" shortcut="X" side="above" />
        </Button>
        {(p.onTrack || job.hasDescription) && (
          <Menu
            label="More job actions"
            side="above"
            className="ml-auto shrink-0"
            trigger={(t) => (
              <button type="button" className={buttonClass("secondary", "md", "rj-btn--icon")} aria-label="More job actions" {...t}>
                {copied ? <Check className="rj-icon text-success-text" aria-hidden /> : <Ellipsis className="rj-icon" aria-hidden />}
                <Tooltip label="More" side="above" />
              </button>
            )}
            items={[
              ...(p.onTrack
                ? [
                    {
                      id: "track",
                      label: p.yours ? "Remove from My companies" : "Add company to My companies",
                      icon: p.yours ? <Check className="rj-icon" aria-hidden /> : <Plus className="rj-icon" aria-hidden />,
                      onSelect: () => void track(),
                    },
                  ]
                : []),
              ...(job.hasDescription && description ? [{ id: "copy", label: "Copy description", icon: <Copy className="rj-icon" aria-hidden />, shortcut: "C", onSelect: () => void copyJd() }] : []),
            ]}
          />
        )}
        {copied && (
          <span className="sr-only" role="status">
            Copied description
          </span>
        )}
      </footer>

      {expanded && !p.expanded && (
        <Dialog open onClose={() => setExpanded(false)} label={job.title} className="h-[calc(100dvh-3rem)] sm:max-w-4xl">
          <div className="h-full w-full overflow-hidden rounded-md border border-line bg-raised shadow-l3">
            <JobDetail {...p} expanded onClose={() => setExpanded(false)} />
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** A job from the company directory nobody has scanned yet: what that means, and "Scan this company" to get the real job. */
function NotCheckedYet({ indexGeneratedAt, onCheck }: { indexGeneratedAt?: string; onCheck?: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    if (!onCheck) return;
    setBusy(true);
    setError(await onCheck());
    setBusy(false);
  };
  return (
    <section className="rounded-md border border-line bg-inset p-3 type-small">
      <p className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-muted" />
        <span className="min-w-0">
          <b>Not scanned yet.</b>{" "}
          <span className="text-muted">
            This job comes from the company directory{indexGeneratedAt ? ` (updated ${timeAgo(indexGeneratedAt)})` : ""}. The score is an estimate from the title, place and date only: topics need the
            description. The link opens the company's careers page. Scans cover the best of these companies a few at a time; unscanned jobs older than {INDEX_MAX_AGE_DAYS} days are hidden unless you
            ask for them.
          </span>
        </span>
      </p>
      {onCheck && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          <Button size="sm" icon={busy ? <LoaderCircle className="rj-icon animate-spin" /> : <RefreshCw className="rj-icon" />} onClick={() => void check()} disabled={busy}>
            {busy ? "Scanning…" : "Scan this company"}
          </Button>
          {error && (
            <span role="alert" className="type-small text-danger-text">
              {error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Whether "Why it matched" shows its bars and checklist; folded by default so the description starts higher. */
const WHY_OPEN_KEY = "rawjobs.whyOpen";

/** The score and its band against your threshold; unfolds to the score bars and a plain-language checklist of why. */
function WhyItMatches({ job, profile, yours }: { job: Job; profile: Profile; yours: boolean }) {
  const [open, setOpen] = useState(() => load<boolean>(WHY_OPEN_KEY, false));
  const toggle = () => {
    save(WHY_OPEN_KEY, !open);
    setOpen(!open);
  };
  const w = job.why;
  const band = BAND_WORD[scoreBandOf(job.score, profile.min_score)];
  // The include term the scorer matched, read the same way ("Sr. PM" is "product manager").
  const titleTerm = useMemo(() => profile.titles.include.find((t) => matchesTitle(job.title, [t])), [job.title, profile]);
  // Topics you listed vs the ones your industries added; and your own topics the posting doesn't mention.
  // A topic found through a word that proves it says which: "payments (as PSP)".
  const named = (k: string) => (w.via?.[k] ? `${k} (as ${w.via[k]})` : k);
  // Topics read from your résumé (you set none yourself) count as yours.
  const fromResume = w.topicsFrom === "resume";
  const own = fromResume ? (w.ownTopics ?? []) : w.keywords.filter((k) => k in profile.keywords);
  const added = w.keywords.filter((k) => !own.includes(k));
  const checked = !job.estimated && job.hasDescription;
  const missing =
    checked && fromResume
      ? (w.missing ?? [])
      : checked
        ? Object.entries(profile.keywords)
            .filter(([k]) => !w.keywords.includes(k))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([k]) => k)
        : [];
  // Scores from before `level` existed carried it in the title points (30 / 25).
  const lv = w.level ?? (w.title === 30 ? 10 : w.title === 25 ? 5 : 0);
  const level = lv === 10 ? ", at your level" : lv === 5 ? ", one level from yours" : profile.seniority_boost.length ? ", not near your level" : "";
  // Pay, visa, must-haves and years: met, missed, or unknown when the posting doesn't say (never shown as a pass).
  const eligibility = (w.checks ?? []).filter((c) => c.id !== "place" && c.id !== "level");
  // One-click fixes for checks your profile got wrong, when your profile can be saved from here.
  const fixer = useProfileFix();
  const fixes = fixer ? fitFixes(job).filter((f) => !fixApplied(f, fixer.draft)) : [];
  const fixFor = (check: string) => fixes.find((f) => f.check === check);
  const items: { ok: boolean; unknown?: boolean; text: ReactNode; fix?: FitFix }[] = [
    {
      ok: w.title > 0,
      fix: fixFor("level"),
      text:
        w.title > 0 ? (
          <>
            Title matches <b>{titleTerm ?? "your roles"}</b>
            {level}
          </>
        ) : (
          "Title isn't one of your roles"
        ),
    },
    {
      ok: w.location > 0,
      text:
        w.location === 20 ? (
          <>
            In one of your places
            {job.countries.length ? (
              <>
                {" "}
                (<b>{job.countries.join(", ")}</b>)
              </>
            ) : null}
          </>
        ) : w.location === 15 ? (
          "Remote, open to your regions"
        ) : (
          (w.locationNote ?? "Not in one of your places")
        ),
    },
    ...(w.scale
      ? []
      : [
          {
            ok: own.length > 0 || added.length > 0,
            text: own.length ? (
              <>
                {w.topicsFrom === "resume" ? "Mentions topics from your résumé" : "Mentions your topics"}: <b>{own.map(named).join(", ")}</b>
                {added.length ? <>; also {added.map(named).join(", ")} from your industries</> : null}
              </>
            ) : added.length ? (
              <>
                Mentions topics from your industries: <b>{added.map(named).join(", ")}</b>
              </>
            ) : checked ? (
              "Doesn't mention your topics"
            ) : (
              "Topics not checked yet: the full posting hasn't been fetched"
            ),
          },
        ]),
    // One year short of the years asked is close enough to count.
    ...eligibility.map((c) => ({ ok: c.status === "met" || (c.id === "experience" && c.status === "near"), unknown: c.status === "unknown", text: c.note, fix: fixFor(c.id) })),
    w.industry === undefined
      ? { ok: (w.freshness ?? 0) >= 6, text: w.freshness === 10 ? "Posted in the last 3 days" : w.freshness === 6 ? "Posted this week" : "Posted more than a week ago" }
      : { ok: w.industry === 10, unknown: w.industry === 5, text: industryText(w.industry, job, profile, yours) },
  ];
  const min = profile.min_score;
  const cutOff = job.score > min ? `above your ${min} cut-off` : job.score === min ? `at your ${min} cut-off` : `below your ${min} cut-off`;
  const parts = scoreParts(w);
  // The level sits inside the title line (a pass); folded, its fix gets a pill of its own.
  const levelFix = fixFor("level");
  const misses = [
    ...items.filter((it) => !it.ok && !it.unknown),
    ...(levelFix && w.title > 0 ? [{ text: w.checks?.find((c) => c.id === "level")?.note ?? "Not near your level", fix: levelFix }] : []),
  ];
  const unknowns = items.filter((it) => it.unknown);
  return (
    <section className={cx("rj-drawer__section rj-fit", open && "gap-4")}>
      {/* On a phone the toggle drops under the verdict rather than squeezing it. */}
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={job.score} threshold={min} estimated={job.estimated} word />
        <div className="min-w-[11rem] flex-1">
          <h3 className="rj-h">Why it matched</h3>
          <p className="type-small text-muted">
            {band} match, {cutOff}. {job.estimated ? "Estimated from title, place and industry." : null}{" "}
            {!open && (
              <span className="sr-only">
                {items.filter((it) => it.ok).length} of {items.length} checks pass.
              </span>
            )}
          </p>
        </div>
        <Button size="sm" variant="quiet" onClick={toggle} aria-expanded={open} aria-controls={`why-${job.id}`} icon={open ? <ChevronUp className="rj-icon" /> : <ChevronDown className="rj-icon" />}>
          {open ? "Hide breakdown" : "Show breakdown"}
        </Button>
      </div>
      {!open && (
        <ul className="rj-pills">
          {parts.map((p) => (
            <li key={p.label} className="rj-pill">
              {p.earned > 0 ? <CircleCheck className="size-4 text-success-text" aria-hidden /> : <X className="size-4 text-muted" aria-hidden />}
              {p.label}{" "}
              <span>
                <b>{p.earned}</b>/{p.max}
              </span>
            </li>
          ))}
          {misses.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
            <li key={i} className="rj-pill rj-pill--miss">
              <X className="size-4 shrink-0" aria-hidden />
              <span>{it.text}</span>
              {it.fix && <FixButton fix={it.fix} />}
            </li>
          ))}
          {unknowns.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
            <li key={`u${i}`} className="rj-pill">
              <CircleHelp className="size-4 shrink-0 text-muted" aria-label="Not stated:" />
              <span>{it.text}</span>
              {it.fix && <FixButton fix={it.fix} />}
            </li>
          ))}
        </ul>
      )}
      {/* A gate or a dealbreaker changes the score past the sum: their own lines below say how. */}
      {w.scale && !w.gate && !w.dealbreakers?.length && (
        <p className="type-small">
          <b>
            {parts.reduce((n, p) => n + p.earned, 0)} of {parts.reduce((n, p) => n + p.max, 0)} points, shown as {job.score} out of 100.
          </b>{" "}
          <span className="text-muted">You have no topics yet, so title, place and industry make up the whole score.</span>
        </p>
      )}
      {w.gate && <p className="type-small text-warning-text">Failed your {w.gate} filter, so the score is 0.</p>}
      {w.heldBack && !w.dealbreakers?.length && (
        <p className="type-small text-warning-text">Adds up to a strong match, but kept just under your cut-off: {w.heldBack.charAt(0).toLowerCase() + w.heldBack.slice(1)}.</p>
      )}
      {!!w.dealbreakers?.length && (
        <div className="type-small text-warning-text" data-dealbreakers>
          <p>
            Breaks {w.dealbreakers.length === 1 ? "one of your dealbreakers" : `${w.dealbreakers.length} of your dealbreakers`}, so the score is at most half what its parts add up to, and under your
            threshold:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {w.dealbreakers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <div id={`why-${job.id}`} className="grid gap-4">
          <ScoreBreakdown score={job.score} parts={parts} missing={missing} />
          <ul className="space-y-1.5 type-small">
            {items.map((it, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
              <li key={i} className="flex items-start gap-2">
                {it.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" />
                ) : it.unknown ? (
                  <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Not stated:" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-muted" />
                )}
                <span className={cx(!it.ok && "text-muted")}>{it.text}</span>
                {it.fix && <FixButton fix={it.fix} />}
              </li>
            ))}
          </ul>
          <p className="type-small text-muted">
            The score is how well the job fits what you asked for, not your odds of an interview. Best match also lists newer jobs{yours ? " and your companies" : ""} higher. The score itself doesn't
            change.
          </p>
        </div>
      )}
    </section>
  );
}

/** A fix beside a check: saves one word to your profile (re-scored on the next scan), or opens the setting. */
function FixButton({ fix }: { fix: FitFix }) {
  const fixer = useProfileFix();
  const [saving, setSaving] = useState(false);
  if (!("field" in fix))
    return (
      <a href={`#${settingsHash(fix.section)}`} className="ml-auto shrink-0 font-medium text-ink underline underline-offset-2 hover:text-muted">
        {fix.label}
      </a>
    );
  const apply = async () => {
    if (!fixer) return;
    setSaving(true);
    const error = await fixer.add(fix.field, fix.value);
    setSaving(false);
    toast({ message: error ?? `${fix.done} Scores update on the next scan.` });
  };
  return (
    <button type="button" onClick={apply} disabled={saving} className="ml-auto shrink-0 font-medium text-ink underline underline-offset-2 hover:text-muted disabled:opacity-60">
      {saving ? "Saving…" : fix.label}
    </button>
  );
}

/** Why the industry part is what it is, without claiming more than the score knows. */
function industryText(points: number, job: Job, profile: Profile, yours: boolean): ReactNode {
  if (points === 5) return "Company's industry not known";
  if (points === 0) return "Not one of your industries";
  const shared = (job.industries ?? []).filter((i) => profile.industries.includes(i)).map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i);
  if (shared.length)
    return (
      <>
        In one of your industries: <b>{shared.join(", ")}</b>
      </>
    );
  if (yours) return "One of your companies, so its industry counts";
  if (!profile.industries.length) return "No industries picked, so every company counts";
  return "In one of your industries";
}

/** The progress dropdown's value for an entry: its status, or "rejected:<how it ended>" for a closed job. */
const progressValue = (e: Entry | undefined) => (e?.status === "rejected" ? `rejected:${e.closedAs ?? "rejected"}` : (e?.status ?? ""));

const shortDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Where a tracked job stands, with dates: "Saved Oct 15 › Applied Oct 16", then, in an active stage, when to
 * follow up, or apply by while saved (changeable, amber once it's due).
 */
function ProgressLine({ entry, id, onUpdate }: { entry: Entry; id: string; onUpdate: (patch: EntryPatch) => void }) {
  // Only the steps still standing: a status set and later cleared drops out of the line.
  const steps = (entry.history ?? []).filter((h): h is { status: Status; at: string } => h.status !== null).slice(-6);
  const since = entry.status && entry.status !== "dismissed" ? stageSince(entry) : undefined;
  const due = followUpDue(entry);
  const active = isActive(entry.status);
  if (!steps.length && !active) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 type-small text-muted">
      {steps.length > 0 && (
        <p>
          {steps.map((h, i) => (
            <Fragment key={h.at}>
              {i > 0 && <span aria-hidden> › </span>}
              {statusLabel({ status: h.status, closedAs: h.status === entry.status ? entry.closedAs : undefined })} {shortDay(h.at)}
            </Fragment>
          ))}
        </p>
      )}
      {since && (
        // Tracked late (you applied last week): set the real date so the timeline and follow-ups count from it.
        <label htmlFor={`${id}-since`} className="flex items-center gap-2">
          {statusLabel(entry)} on
          <input
            id={`${id}-since`}
            type="date"
            value={dayAfter(since, 0)}
            max={dayAfter(new Date().toISOString(), 0)}
            onChange={(e) => e.target.value && onUpdate({ since: e.target.value })}
            className="h-8 rounded-md border border-line bg-raised px-2 type-small text-ink"
          />
        </label>
      )}
      {active && (
        <label htmlFor={id} className={cx("flex items-center gap-2", due && "font-medium text-warning-text")}>
          {entry.status === "saved" ? (due ? "Apply now" : "Apply by") : due ? "Follow up now" : "Follow up on"}
          <input
            id={id}
            type="date"
            value={entry.followUp ?? ""}
            onChange={(e) => onUpdate({ followUp: e.target.value || undefined })}
            className="h-8 rounded-md border border-line bg-raised px-2 type-small text-ink"
          />
        </label>
      )}
    </div>
  );
}

/** Which CV you sent: folded to a small button until there is one, saved on blur. */
function CvField({ id, cv, onSave }: { id: string; cv: string; onSave: (cv: string) => void }) {
  const [open, setOpen] = useState(!!cv);
  if (!open)
    return (
      <Button size="sm" variant="quiet" icon={<FileText className="rj-icon" />} onClick={() => setOpen(true)}>
        CV used
      </Button>
    );
  return (
    <label htmlFor={id} className="flex items-center gap-2 type-small text-muted">
      CV used
      <input
        id={id}
        // Opened from "CV used": straight into typing.
        // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened, as the pattern expects
        autoFocus={!cv}
        defaultValue={cv}
        onBlur={(e) => e.target.value.trim() !== cv && onSave(e.target.value.trim())}
        placeholder="Fintech PM v3"
        className="h-8 w-40 rounded-md border border-line bg-inset px-2 type-small text-ink placeholder:text-muted"
      />
    </label>
  );
}

/**
 * Notes for one job. Saved on blur, and also when the field goes away (Escape closes the drawer while typing),
 * so nothing typed is lost.
 */
function NotesField({ id, note, onSave }: { id: string; note: string; onSave: (note: string) => void }) {
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const flush = () => {
    if (pending.current !== null && pending.current !== note) save.current(pending.current);
    pending.current = null;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  // Folded to one small button until there's a note, so the description starts higher.
  const [open, setOpen] = useState(!!note);
  if (!open)
    return (
      <div>
        <Button size="sm" variant="quiet" icon={<StickyNote className="rj-icon" />} onClick={() => setOpen(true)}>
          Add a note
        </Button>
      </div>
    );
  return (
    <div className="grid basis-full gap-1">
      <label htmlFor={id} className="type-label">
        Notes
      </label>
      <textarea
        id={id}
        // Opened from "Add a note": straight into typing.
        // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened (a menu, a dialog field), as the pattern expects
        autoFocus={!note}
        defaultValue={note}
        onChange={(e) => (pending.current = e.target.value)}
        onBlur={flush}
        placeholder="Referral, recruiter name, follow-up date…"
        rows={2}
        className="w-full resize-y rounded-md border border-line bg-inset p-2.5 type-small placeholder:text-muted"
      />
    </div>
  );
}

/** Description text with the user's topic words highlighted. */
function Highlighted({ text, terms, wide }: { text: string; terms: string[]; wide?: boolean }) {
  const parts = useMemo(() => {
    if (!terms.length) return [text];
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
    return text.split(re);
  }, [text, terms]);
  return (
    <div className={cx("max-w-prose whitespace-pre-wrap break-words text-ink", wide ? "type-body leading-7" : "type-small leading-6")}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          <mark key={i} className="rounded-sm bg-inset px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </div>
  );
}
