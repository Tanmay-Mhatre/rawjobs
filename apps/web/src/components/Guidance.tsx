import { diagnoseNoMatches } from "@rawjobs/core/diagnose";
import { ArrowRight, Bell, Check, ChevronDown, ChevronRight, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { scheduleStatus } from "../lib/automation";
import type { Config } from "@rawjobs/core/schema";
import { keyOf } from "../lib/companies";
import { canRunLocally, type DataMeta, type Job } from "../lib/data";
import type { ScanState } from "../lib/scan";
import { STEP, STEP_COUNT } from "../lib/setup";
import { load, save } from "../lib/storage";
import { ScanProgress } from "./ScanProgress";
import { Button, Card, cx } from "./ui";

/** Settings > Scheduled scans (Telegram alerts sit right below it). */
export const goDailyAlerts = () => {
  location.hash = "settings?section=schedule";
};

type Item = { key: string; label: string; detail: string; done: boolean; step?: number /** Nice to have: not counted in progress. */; optional?: boolean };

/** What's set up and what's missing, from the saved config and the latest run. */
export function checklistItems(config: Config | undefined, meta: DataMeta | undefined, hasResume = false): Item[] {
  const p = config?.profile;
  const last = meta?.runs[0];
  // Your companies only: a scan also checks companies you haven't added.
  const yours = new Set((config?.companies ?? []).map(keyOf));
  const health = (last?.health ?? []).filter((h) => yours.has(keyOf(h)));
  const working = health.filter((h) => h.ok).length;
  const failing = health.filter((h) => !h.ok && !h.unsupported).length;
  const companies = config?.companies.length ?? 0;
  const ind = p?.industries.length ?? 0;
  return [
    { key: "resume", label: "Master resume", detail: hasResume ? "Saved" : "Recommended", done: hasResume, step: STEP.resume },
    { key: "roles", label: "Target roles", detail: p?.titles.include.length ? p.titles.include.slice(0, 3).join(", ") : "Not set", done: !!p?.titles.include.length, step: STEP.roles },
    {
      key: "locations",
      label: "Locations",
      detail: p ? [...p.locations.include.slice(0, 3), ...(p.locations.remote_ok.length ? ["remote"] : [])].join(", ") || "Not set" : "Not set",
      done: !!p && (p.locations.include.length > 0 || p.locations.remote_ok.length > 0),
      step: STEP.locations,
    },
    { key: "industries", label: "Industries", detail: ind ? `${ind} picked` : "Recommended", done: ind > 0, step: STEP.industries },
    {
      key: "companies",
      label: "Companies you'd like to work at",
      detail: !companies ? "Optional: their jobs go to the top" : last && health.length ? `${working} working${failing ? `, ${failing} failing` : ""}` : `${companies} added`,
      done: companies > 0 && failing === 0,
      optional: true,
    },
    { key: "scan", label: "First scan", detail: last ? "Done" : "Not run yet", done: !!last },
    // Scheduled scans and Telegram need this computer, so a hosted copy doesn't offer them.
    ...(canRunLocally ? [{ key: "daily", label: "Daily scans + Telegram alerts", detail: "Optional: get new jobs on your phone every day", done: false, optional: true }] : []),
  ];
}

const DISMISS_KEY = "rawjobs.checklist.dismissed";

type Actions = { onStep: (n: number) => void; onScan: () => void; onCompanies: () => void };

/** Where a checklist item takes you, if anywhere. */
const actionFor = (i: Item, { onStep, onScan, onCompanies }: Actions): (() => void) | undefined =>
  i.key === "scan" ? onScan : i.key === "companies" ? onCompanies : i.key === "daily" ? goDailyAlerts : i.step ? () => onStep(i.step!) : undefined;

function ChecklistRows({ items, ...actions }: { items: Item[] } & Actions) {
  return (
    <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
      {items.map((i) => {
        const action = actionFor(i, actions);
        return (
          <li key={i.key} className="sm:border-b sm:border-line sm:odd:border-r">
            <button type="button" disabled={!action} onClick={action} className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-inset/60 disabled:cursor-default">
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-sm border",
                  i.done ? "border-ink bg-ink text-raised" : i.key === "daily" ? "border-line text-muted" : "border-line",
                )}
              >
                {i.done ? <Check className="size-3.5" aria-label="Done" /> : i.key === "daily" ? <Bell className="size-3" aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block type-label">{i.label}</span>
                <span className={cx("block truncate type-small", i.detail.includes("failing") ? "text-danger-text" : "text-muted")}>{i.detail}</span>
              </span>
              {action && <ChevronRight className="size-4 text-muted" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const countDone = (items: Item[]) => {
  const core = items.filter((i) => !i.optional);
  return { done: core.filter((i) => i.done).length, total: core.length };
};

function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <div
      className={cx("rj-progress__track", className)}
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} done`}
    >
      <span className="rj-progress__fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
    </div>
  );
}

/** Configured, but something's still missing (or it's all done and collapses to one line). */
export function SetupChecklist({ items, onStep, onScan, onCompanies }: { items: Item[]; onStep: (n: number) => void; onScan: () => void; onCompanies: () => void }) {
  const [dismissed, setDismissed] = useState(() => load(DISMISS_KEY, false));
  const [expanded, setExpanded] = useState(false);
  const { done, total } = countDone(items);
  const complete = done === total;
  // Already scanning on a schedule: no need to point at it.
  const [scheduled, setScheduled] = useState(false);
  useEffect(() => {
    if (complete && !dismissed && canRunLocally)
      void scheduleStatus().then(
        (s) => setScheduled(!!s.installed),
        () => {},
      );
  }, [complete, dismissed]);
  // "Setup complete" shows on one visit only: it stays up now, and is remembered as seen for next time,
  // so it doesn't take room above the jobs every day.
  useEffect(() => {
    if (complete && !dismissed) save(DISMISS_KEY, true);
  }, [complete, dismissed]);
  if (complete && dismissed) return null;
  if (complete) {
    const daily = items.find((i) => i.key === "daily");
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-raised px-4 py-2.5 type-small">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-ink text-raised">
          <Check className="size-3" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <b>Setup complete.</b>{" "}
          {daily && !scheduled && (
            <span className="text-muted">
              Next:{" "}
              <button type="button" className="font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={goDailyAlerts}>
                get new jobs on Telegram every day <span aria-hidden="true">&rarr;</span>
              </button>
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Hide setup checklist"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
          onClick={() => {
            save(DISMISS_KEY, true);
            setDismissed(true);
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  // After the first scan, what's left shrinks to one line; "Show all" opens the full list.
  const scanned = items.some((i) => i.key === "scan" && i.done);
  if (scanned) {
    const left = total - done;
    const next = items.find((i) => !i.done && !i.optional) ?? items.find((i) => !i.done);
    const nextAction = next && actionFor(next, { onStep, onScan, onCompanies });
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 type-small">
          <p className="min-w-0 flex-1">
            <b>
              {left} step{left === 1 ? "" : "s"} left
            </b>
            {next && (
              <>
                :{" "}
                {nextAction ? (
                  <button type="button" className="font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={nextAction}>
                    {next.label}
                  </button>
                ) : (
                  next.label
                )}
              </>
            )}
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="setup-checklist-rows"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-muted hover:bg-inset hover:text-ink"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Hide" : "Show all"}
            <ChevronDown aria-hidden="true" size={16} className={cx("transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
        {expanded && (
          <div id="setup-checklist-rows" className="border-t border-line">
            <ChecklistRows items={items} onStep={onStep} onScan={onScan} onCompanies={onCompanies} />
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="type-small font-semibold">Finish setting up</h2>
          <p className="type-meta text-muted">
            {done} of {total} done
          </p>
        </div>
        <ProgressBar done={done} total={total} className="hidden w-32 sm:block" />
      </header>
      <ChecklistRows items={items} onStep={onStep} onScan={onScan} onCompanies={onCompanies} />
    </Card>
  );
}

/** Not set up yet: what RawJobs does, how far they got, and one clear next step. */
export function SetupHero({ items, started, nextStep, onStep, onCompanies }: { items: Item[]; started: boolean; nextStep: number; onStep: (n: number) => void; onCompanies: () => void }) {
  const { done, total } = countDone(items);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="min-w-0 flex-1">
          <h2 className="type-subheading font-semibold">{started ? "Finish setting up your radar" : "Set up your radar"}</h2>
          <p className="mt-0.5 type-small text-muted">Pick the roles and places you want. RawJobs finds and ranks matching jobs across thousands of companies. Setup takes about 3 minutes.</p>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar done={done} total={total} className="w-40" />
            <span className="tabular type-meta text-muted">
              {done} of {total} done
            </span>
          </div>
        </div>
        <Button variant="primary" className="h-11 shrink-0 px-5 type-body" onClick={() => onStep(started ? nextStep : STEP.resume)}>
          {started ? `Continue setup · step ${nextStep} of ${STEP_COUNT}` : "Start setup"} <ArrowRight className="size-4" />
        </Button>
      </div>
      <div className="border-t border-line">
        <ChecklistRows items={items} onStep={onStep} onScan={() => onStep(STEP.review)} onCompanies={onCompanies} />
      </div>
    </Card>
  );
}

/** The saved settings exist but don't validate (usually a hand edit). */
export function ConfigProblemCard({ errors, onFix }: { errors?: string; onFix: () => void }) {
  return (
    <Card className="border-warning/40 p-5">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Some of your saved settings can't be read</h2>
          <p className="mt-0.5 type-small text-muted">Scans can't run until they're fixed. Setup loads everything it can read, so you only fix what's wrong.</p>
          {errors && (
            <details className="mt-2 type-meta text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-2.5 font-mono">{errors}</pre>
            </details>
          )}
        </div>
      </div>
      <Button variant="primary" className="mt-4" onClick={onFix}>
        Fix in setup <ArrowRight className="size-4" />
      </Button>
    </Card>
  );
}

/** Saved config, no scan yet. */
export function FirstScanCard({ scan, onScan }: { scan: ScanState; onScan: () => void }) {
  const running = scan.phase === "running";
  return (
    <Card>
      <div className="rj-empty">
        <h2 className="rj-empty__title">{running ? "Finding jobs for you…" : "Ready for your first scan"}</h2>
        <p className="rj-empty__body">Checks thousands of companies for jobs that match your roles and places. This usually takes a few minutes.</p>
        {running ? (
          <div className="w-full">
            <ScanProgress scan={scan} onRetry={onScan} />
          </div>
        ) : (
          <div className="rj-empty__actions">
            <Button variant="primary" className="h-11 px-5 type-body" onClick={onScan}>
              <RefreshCw className="size-4" /> Start my first scan
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** A scan ran but nothing passed the title and location gates: explain why, and offer fixes. */
export function NoMatches({ jobs, onStep, onCompanies }: { jobs: Job[]; onStep: (n: number) => void; onCompanies: () => void }) {
  const d = useMemo(() => diagnoseNoMatches(jobs), [jobs]);
  return (
    <Card className="p-5 sm:p-6">
      <div className="max-w-prose">
        <div>
          <h2 className="type-subheading font-semibold">No matches yet. Here's why.</h2>
          <p className="mt-1 type-small text-muted">
            Checked <b className="tabular font-semibold text-ink">{d.scanned.toLocaleString()}</b> open jobs: <b className="tabular font-semibold text-ink">{d.titleMiss.toLocaleString()}</b> had other
            job titles and <b className="tabular font-semibold text-ink">{d.locationMiss.toLocaleString()}</b> had the right title but were in other places.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-line p-3">
          <h3 className="type-small font-semibold">Right title, other places</h3>
          {d.nearMissLocations.length ? (
            <ul className="mt-2 space-y-1 type-small">
              {d.nearMissLocations.map((l) => (
                <li key={l.location} className="flex justify-between gap-2">
                  <span className="truncate text-muted">{l.location}</span>
                  <span className="tabular shrink-0">{l.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 type-small text-muted">None. No company checked is hiring for this role right now.</p>
          )}
          <Button size="sm" className="mt-3" onClick={() => onStep(STEP.locations)}>
            Add locations or remote <ArrowRight className="size-3.5" />
          </Button>
        </div>
        <div className="rounded-md border border-line p-3">
          <h3 className="type-small font-semibold">Right place, other titles</h3>
          {d.nearMissTitles.length ? (
            <ul className="mt-2 space-y-1 type-small text-muted">
              {d.nearMissTitles.map((t) => (
                <li key={t} className="truncate">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 type-small text-muted">No other openings in your places right now.</p>
          )}
          <Button size="sm" className="mt-3" onClick={() => onStep(STEP.roles)}>
            Widen job titles <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
      <p className="mt-4 type-small text-muted">
        Or{" "}
        <button type="button" className="font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={onCompanies}>
          add companies you'd like to work at
        </button>
        : RawJobs scans them every time, even ones the directory doesn't list.
      </p>
    </Card>
  );
}

export function FailingBanner({ count, onOpen, className }: { count: number; onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        className,
        "flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-warning/40 bg-warning-subtle/40 px-4 py-2.5 text-left type-small hover:bg-warning-subtle/60",
      )}
    >
      <TriangleAlert className="size-4 shrink-0 text-warning-text" />
      <span className="min-w-48 flex-1">
        <b>
          {count} compan{count === 1 ? "y" : "ies"}
        </b>{" "}
        couldn't be scanned last time. Usually the careers page moved.
      </span>
      <span className="pl-6.5 font-medium text-warning-text underline underline-offset-2 sm:pl-0">Review failing companies</span>
    </button>
  );
}
