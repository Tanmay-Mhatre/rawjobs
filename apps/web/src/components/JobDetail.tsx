import { displayName } from "@rawjobs/core/display-name";
import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { SENIORITY_LEVELS } from "@rawjobs/core/catalog/seniority";
import { sponsorOf, sponsorSentence, sponsorTitle, VISA_REGISTERS } from "@rawjobs/core/catalog/visa";
import { matchesTitle, safeUrl } from "@rawjobs/core/text";
import { ArrowLeft, Bookmark, Check, ChevronDown, ChevronUp, CircleCheck, Copy, ExternalLink, Info, LoaderCircle, Maximize2, Plus, RefreshCw, Star, StickyNote, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { useDescription, type Job, type Profile } from "../lib/data";
import { formatDate, formatSalary, placeSummary, postedOrSeen, timeAgo } from "../lib/format";
import { atsLabel, evergreenReason, INDEX_MAX_AGE_DAYS, isOlder } from "../lib/filters";
import { load, save } from "../lib/storage";
import { PIPELINE, STATUS_LABEL, type Entry, type Status } from "../lib/userState";
import { Dialog } from "./Dialog";
import { ReasonPicker, useNotForMe } from "./NotForMe";
import { Button, buttonClass, Chip, ChipGroup, IconButton, ScoreBadge, scoreBandOf, ScoreBreakdown, scoreParts, SourceTag } from "./primitives";
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
  onUpdate: (patch: { status?: Status; note?: string }) => void;
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

/** Everything about one job (design/components/Drawer): head with source, title and meta; body with the score, status, description and details; foot with the actions. */
export function JobDetail(p: JobDetailProps) {
  const { job, entry, profile } = p;
  const description = useDescription(job);
  const [copied, setCopied] = useState(false);
  /** The full-window reader, for reading the whole description in one view. */
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const salary = formatSalary(job.salary);
  const status = entry?.status;
  const notForMe = useNotForMe();
  const source = atsLabel(job.ats);

  // biome-ignore lint/correctness/useExhaustiveDependencies: another job opened: scroll back to the top and reset
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setCopied(false);
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
  const places = postings
    ? placeSummary(postings.flatMap((j) => (j.cities.length ? j.cities : j.location ? [j.location] : [])))
    : placeSummary(job.cities.length ? job.cities : job.location ? [job.location] : []);
  const age = timeAgo(postedOrSeen(job)).replace(/ ago$/, "");
  const workplace = WORKPLACE_LABEL[job.workplace];
  const evergreen = evergreenReason(job);
  // On a government list of visa sponsors for the job's country (any of the role's places).
  const sponsor = sponsorOf(postings ?? [job]);
  const meta: ReactNode[] = [
    job.company,
    places,
    ...(workplace ? [workplace] : []),
    SENIORITY_LABEL[job.seniority],
    isOlder(job) && job.status === "open" ? (
      <span key="older" className="text-warning-text" title="Most roles are filled within two months. It's still listed, but may no longer be hiring.">
        {job.postedAt ? "Posted" : "First seen"} {age} ago · may be filled
      </span>
    ) : job.postedAt ? (
      `Posted ${formatDate(job.postedAt)}`
    ) : (
      `First seen ${formatDate(job.firstSeen)}`
    ),
    ...(salary ? [salary] : []),
    ...(sponsor
      ? [
          <span key="visa" className="text-success-text" title={sponsorTitle(sponsor)}>
            Sponsors visas
          </span>,
        ]
      : []),
    ...(evergreen === "pool"
      ? [
          <span key="pool" className="text-warning-text" title="A talent pool or open application: it collects applications rather than filling one role">
            Talent pool
          </span>,
        ]
      : []),
    ...(evergreen === "reposted"
      ? [
          <span key="reposted" className="text-warning-text" title={`Taken down and posted again on ${formatDate(job.repostedAt)}: dated from the first posting`}>
            Reposted
          </span>,
        ]
      : []),
    // We read it off the company's own board: say when, so "is this still open?" has an answer.
    ...(job.status === "closed" ? ["Closed"] : job.estimated ? [] : [`Still listed · checked ${timeAgo(job.lastSeen)}`]),
  ];
  const saved = status === "saved";

  const descriptionSection = (
    <section className="rj-drawer__section">
      <h3 className="rj-h">Description</h3>
      {description === undefined ? (
        <p className="flex items-center gap-2 type-small text-muted">
          <LoaderCircle className="size-4 animate-spin" /> Loading…
        </p>
      ) : description ? (
        <Highlighted text={description} terms={job.why.keywords} wide={p.expanded} />
      ) : (
        <p className="type-small text-muted">
          {job.estimated ? "Not scanned yet, so no description." : job.why.gate ? "Not stored for jobs that fail your filters." : "The hiring system didn't include a description."} Open the job page
          to read it.
        </p>
      )}
    </section>
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className="rj-drawer__head">
        <div className="rj-drawer__top">
          <SourceTag source={source} age={age} isNew={p.isNew} older={isOlder(job)} />
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
          <span className="min-w-0">{job.title}</span>
        </h2>
        <MetaLine className="rj-drawer__meta" parts={meta} />
      </header>

      <div ref={scrollRef} className={cx("rj-drawer__body min-h-0 flex-1", p.expanded && "md:grid-cols-[minmax(0,1fr)_20rem] md:gap-x-10")}>
        {/* Expanded: the description gets the wide column, everything else sits beside it. */}
        {p.expanded && descriptionSection}
        <div className={cx("grid min-w-0 grid-cols-1 content-start gap-6", p.expanded && "md:col-start-2 md:row-start-1")}>
          <WhyItMatches job={job} profile={profile} yours={!!p.yours} />

          {job.estimated && <NotCheckedYet indexGeneratedAt={p.indexGeneratedAt} onCheck={p.onCheck} />}

          {sponsor && (
            <section className="rj-drawer__section">
              <h3 className="rj-h text-success-text">Sponsors visas</h3>
              <p className="type-small">{sponsorSentence(displayName(job.company), sponsor)}</p>
              <p className="type-small text-muted">That means it can sponsor, not that this role will. Source: {VISA_REGISTERS[sponsor.country].source}.</p>
            </section>
          )}

          <section className="rj-drawer__section">
            <h3 className="rj-h">Your status</h3>
            {/* The one place to set any status; Save in the foot is a shortcut for "Saved". */}
            <ChipGroup label="Your status">
              {[...PIPELINE, "dismissed" as const].map((s) => (
                <Chip
                  key={s}
                  pressed={status === s}
                  onClick={() => {
                    const next = status === s ? undefined : s;
                    p.onUpdate({ status: next });
                    // Beside the list the job leaves at once, so the reasons go in a toast; in a drawer they're right below.
                    if (next === "dismissed" && !p.onClose) notForMe?.askWhy(job, status);
                  }}
                >
                  {STATUS_LABEL[s]}
                </Chip>
              ))}
            </ChipGroup>
            {status === "dismissed" && <ReasonPicker key={`why:${job.id}`} job={job} label="Why not? Optional." live />}
            <NotesField key={job.id} id={`notes-${job.id}`} note={entry?.note ?? ""} onSave={(note) => p.onUpdate({ note: note || undefined })} />
          </section>

          {postings && (
            <section className="rj-drawer__section">
              <h3 className="rj-h">Posted in {postings.length} locations</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {postings.map((j) => (
                  <li key={j.id} className={cx("flex items-center gap-2 px-3 py-2 type-small", j.id === job.id && "bg-active")}>
                    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => p.onOpenJob?.(j)} aria-current={j.id === job.id || undefined}>
                      {j.location || "Location not listed"}
                    </button>
                    <span className="tabular text-muted">{j.score}</span>
                    <a href={safeUrl(j.url)} target="_blank" rel="noreferrer" onClick={() => p.onApply?.(j)} className="text-muted hover:text-ink" aria-label={`Open the ${j.location} posting`}>
                      <ExternalLink className="rj-icon" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!p.expanded && descriptionSection}

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

          {(p.moreFromCompany?.length || p.onHideCompany) && (
            <section className="rj-drawer__section">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="rj-h">More from {displayName(job.company)}</h3>
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
        <a href={safeUrl(job.url)} target="_blank" rel="noreferrer" onClick={() => p.onApply?.(job)} className={buttonClass("primary")}>
          <ExternalLink className="rj-icon" />
          {job.estimated ? "Open careers page" : `Apply on ${source}`}
        </a>
        <Button
          icon={saved ? <Check className="rj-icon" /> : <Bookmark className="rj-icon" />}
          shortcut="S"
          onClick={() => p.onUpdate({ status: saved ? undefined : "saved" })}
          aria-pressed={saved}
          className="aria-pressed:border-ink aria-pressed:bg-active"
        >
          {saved ? "Saved" : "Save"}
        </Button>
        {p.onTrack && <TrackButton yours={!!p.yours} onTrack={p.onTrack} />}
        {job.hasDescription && (
          <IconButton
            label={copied ? "Copied description" : "Copy description"}
            shortcut={description ? "C" : undefined}
            onClick={() => void copyJd()}
            disabled={!description}
            aria-live="polite"
            className="ml-auto"
          >
            {copied ? <Check className="rj-icon text-success-text" /> : description === undefined ? <LoaderCircle className="rj-icon animate-spin" /> : <Copy className="rj-icon" />}
          </IconButton>
        )}
      </footer>

      {expanded && !p.expanded && (
        <Dialog open onClose={() => setExpanded(false)} label={job.title} className="h-[calc(100dvh-3rem)] sm:max-w-4xl">
          <div className="h-full w-full overflow-hidden rounded-md border border-line bg-raised shadow-l3">
            <JobDetail {...p} expanded onClose={() => setExpanded(false)} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Add the job's company to your companies (or remove it), with a short busy state and any error. */
function TrackButton({ yours, onTrack }: { yours: boolean; onTrack: (on: boolean) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of `yours` clears the last error
  useEffect(() => setError(null), [yours]);
  const click = async () => {
    setBusy(true);
    setError(await onTrack(!yours));
    setBusy(false);
  };
  return (
    <>
      <Button
        icon={busy ? <LoaderCircle className="rj-icon animate-spin" /> : yours ? <Check className="rj-icon" /> : <Plus className="rj-icon" />}
        onClick={() => void click()}
        disabled={busy}
        aria-pressed={yours}
        className="aria-pressed:border-ink aria-pressed:bg-active"
        title={yours ? "Remove from My companies" : "Add to My companies: scanned every time, its jobs listed first"}
      >
        {/* Short enough for half a phone screen, and the same everywhere; the tooltip says the rest. */}
        {yours ? "In My companies" : "Add company"}
      </Button>
      {error && (
        <p role="alert" className="col-span-full w-full type-small text-danger-text">
          {error}
        </p>
      )}
    </>
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
  const own = w.keywords.filter((k) => k in profile.keywords);
  const added = w.keywords.filter((k) => !(k in profile.keywords));
  const checked = !job.estimated && job.hasDescription;
  const missing = checked
    ? Object.entries(profile.keywords)
        .filter(([k]) => !w.keywords.includes(k))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k]) => k)
    : [];
  const level = w.title === 30 ? ", at your level" : w.title === 25 ? ", one level from yours" : profile.seniority_boost.length ? ", not near your level" : "";
  const items: { ok: boolean; text: ReactNode }[] = [
    {
      ok: w.title > 0,
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
                Mentions your topics: <b>{own.join(", ")}</b>
                {added.length ? <>; also {added.join(", ")} from your industries</> : null}
              </>
            ) : added.length ? (
              <>
                Mentions topics from your industries: <b>{added.join(", ")}</b>
              </>
            ) : checked ? (
              "Doesn't mention your topics"
            ) : (
              "Topics not checked yet: the full posting hasn't been fetched"
            ),
          },
        ]),
    w.industry === undefined
      ? { ok: (w.freshness ?? 0) >= 6, text: w.freshness === 10 ? "Posted in the last 3 days" : w.freshness === 6 ? "Posted this week" : "Posted more than a week ago" }
      : { ok: w.industry > 0, text: industryText(w.industry, job, profile, yours) },
  ];
  return (
    <section className={cx("rj-drawer__section", open && "gap-4")}>
      <div className="flex items-center gap-3">
        <ScoreBadge score={job.score} threshold={profile.min_score} estimated={job.estimated} />
        <div className="min-w-0 flex-1">
          <h3 className="rj-h">Why it matched</h3>
          <p className="type-small text-muted">
            {band} match. {job.estimated ? "Estimated from title, place and industry." : `Threshold ${profile.min_score}.`}{" "}
            {!open && (
              <span className="sr-only">
                {items.filter((it) => it.ok).length} of {items.length} checks pass.
              </span>
            )}
          </p>
        </div>
        <Button size="sm" variant="quiet" onClick={toggle} aria-expanded={open} aria-controls={`why-${job.id}`} icon={open ? <ChevronUp className="rj-icon" /> : <ChevronDown className="rj-icon" />}>
          {open ? "Less" : "Details"}
        </Button>
      </div>
      {w.gate && <p className="type-small text-warning-text">Failed your {w.gate} filter, so the score is 0.</p>}
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
          <ScoreBreakdown score={job.score} parts={scoreParts(w)} missing={missing} />
          <ul className="space-y-1.5 type-small">
            {items.map((it, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
              <li key={i} className="flex items-start gap-2">
                {it.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" /> : <X className="mt-0.5 size-4 shrink-0 text-muted" />}
                <span className={cx(!it.ok && "text-muted")}>{it.text}</span>
              </li>
            ))}
          </ul>
          {w.scale && <p className="type-small text-muted">No topics set: title, place and industry make up the whole score.</p>}
          <p className="type-small text-muted">
            The score is how well the job fits. In Best match, newer jobs rank higher (the boost halves every 3 days){yours ? ", and your companies get +10" : ""}.
          </p>
        </div>
      )}
    </section>
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
    <div className="mt-2 grid gap-1">
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
