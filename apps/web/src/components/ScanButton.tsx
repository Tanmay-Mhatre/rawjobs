import { Check, ChevronDown, Layers, LoaderCircle, Pause, Play, RefreshCw, Settings as SettingsIcon, Square, Star, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { atsLabel } from "../lib/filters";
import { roughCount } from "../lib/format";
import {
  aboutRange,
  ago,
  backgroundLeft,
  backgroundSteps,
  clock,
  progressRows,
  scanLine,
  setScanPrefs,
  sourceRows,
  STALL_MS,
  startingSteps,
  took,
  useScanPrefs,
  type Background,
  type ScanState,
  type Step,
} from "../lib/scan";
import { scanPlan, type ScanPlan, type ScanScope } from "../lib/setup";
import { IconButton as RjIconButton, Menu } from "./primitives";
import { ScanBars } from "./ScanBars";
import { Button, cx } from "./ui";

/** "About 3 min." for a menu or Settings hint. */
const about = (seconds: number) => {
  const t = aboutRange(seconds);
  return `${t[0]!.toUpperCase()}${t.slice(1)}.`;
};

/** What each scan covers and how long it takes, in the words of the menu and Settings. */
export function scanHints(plan: ScanPlan | null): Record<ScanScope, string> {
  const mine = plan?.mine;
  const yours = plan?.yours;
  const all = plan?.all;
  return {
    mine: mine?.fallback
      ? `The job feed is out of date, so this checks every company: ${aboutRange(mine.seconds)}.`
      : `Your companies, past matches and new jobs on the feed.${mine ? ` ${about(mine.seconds)}` : ""}`,
    yours: yours ? `${yours.yours.toLocaleString()} ${yours.yours === 1 ? "company" : "companies"}. ${about(yours.seconds)}` : "The companies you've added.",
    all: all ? `${roughCount(all.yours + all.extra)} companies. ${about(all.seconds)} Keep this computer on.` : "Every company in the directory. Keep this computer on.",
  };
}

/** The scan plan (GET /api/scan/plan), fetched again after each scan: it changes what the next one covers. */
export function useScanPlan(key: unknown): ScanPlan | null {
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` (the scan's phase) is the reason to ask again
  useEffect(() => {
    let live = true;
    void scanPlan().then((p) => live && setPlan(p));
    return () => {
      live = false;
    };
  }, [key]);
  return plan;
}

/**
 * "Scan now" starts your scan straight away (Settings > Scans picks which: the scan, or only your
 * companies). The arrow opens the menu: Scan now, Only my companies, Check every company now, Scan
 * settings, each saying how long it takes. While a scan runs it becomes the scan's status
 * (ScanStatus); while the background check runs, a quiet pill sits next to it (BackgroundPill).
 */
export function ScanButton({
  scan,
  background,
  onStart,
  onStop,
  onResume,
  onSettings,
  notify,
  notifyLine,
}: {
  scan: ScanState;
  /** A scheduled scan (one this page didn't start) is running: no second scan until it ends. */
  background?: boolean;
  onStart: (scope: ScanScope) => void;
  onStop: () => void;
  /** Carry on a paused background check. */
  onResume: () => void;
  onSettings: () => void;
  /** The Telegram bell, given a way to open the scan details. */
  notify?: (openDetails: () => void) => ReactNode;
  /** What happens when the scan ends, for the details. */
  notifyLine?: string;
}) {
  const prefs = useScanPrefs();
  const plan = useScanPlan(scan.phase);
  if (scan.phase === "running") return <ScanStatus scan={scan} onStop={onStop} notify={notify} notifyLine={notifyLine} />;
  if (background) {
    return (
      <Button size="sm" disabled title="A scheduled scan is running. Its new jobs show up here by themselves when it's done.">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Scheduled scan running…
      </Button>
    );
  }
  const hints = scanHints(plan);
  return (
    <div className="flex items-center gap-2">
      {scan.bg && (scan.phase === "background" || (scan.phase === "done" && scan.bg.summary?.stopped)) && <BackgroundPill scan={scan} bg={scan.bg} onPause={onStop} onResume={onResume} />}
      <div className="inline-flex">
        <Button size="sm" className="rounded-r-0" onClick={() => onStart(prefs.scope)} title={prefs.scope === "yours" ? "Scan now: only my companies" : "Scan now"}>
          <RefreshCw className="size-3.5" /> Scan now
        </Button>
        <Menu
          label="Scan options"
          trigger={({ ref, ...rest }) => (
            <button ref={ref} type="button" className="rj-btn rj-btn--secondary rj-btn--sm -ml-px rounded-l-0 px-1.5" aria-label="More scan options" title="More scan options" {...rest}>
              <ChevronDown className="size-3.5" />
            </button>
          )}
          items={[
            { id: "mine", label: "Scan now", hint: hints.mine, icon: <RefreshCw className="rj-icon" aria-hidden />, onSelect: () => onStart("mine") },
            { id: "yours", label: "Only my companies", hint: hints.yours, icon: <Star className="rj-icon" aria-hidden />, onSelect: () => onStart("yours") },
            { separator: true, id: "s1" },
            { id: "all", label: "Check every company now", hint: hints.all, icon: <Layers className="rj-icon" aria-hidden />, onSelect: () => onStart("all") },
            { separator: true, id: "s2" },
            { id: "settings", label: "Scan settings", icon: <SettingsIcon className="rj-icon" aria-hidden />, onSelect: onSettings },
          ]}
        />
      </div>
    </div>
  );
}

/** A small ring that fills as the scan goes; spins until the scan knows how many companies it covers. */
function ProgressRing({ value }: { value: number | null }) {
  if (value === null) return <LoaderCircle className="rj-icon animate-spin text-muted" aria-hidden />;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="rj-icon -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--progress-track)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--progress-fill)"
        strokeWidth="2.5"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        className="transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}

/** Details that open on hover or focus ("hover") and stay when clicked ("pinned") until Esc or a click elsewhere. */
function useHoverDetails() {
  const [open, setOpen] = useState<false | "hover" | "pinned">(false);
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (open !== "pinned") return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const rootProps = {
    ref: root,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && later(() => setOpen((o) => o || "hover"), 120),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && later(() => setOpen((o) => (o === "hover" ? false : o)), 200),
    onBlur: (e: React.FocusEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen((o) => (o === "hover" ? false : o)),
  };
  const triggerProps = {
    onClick: () => setOpen((o) => (o === "pinned" ? false : "pinned")),
    onFocus: (e: React.FocusEvent<HTMLButtonElement>) => e.currentTarget.matches(":focus-visible") && setOpen((o) => o || "hover"),
    "aria-expanded": !!open,
  };
  return { open, setOpen, rootProps, triggerProps };
}

/** The time now, every second while `on` (an open pop-over's timer and "2s ago"). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

/** Starting: a bar that sweeps (the total isn't known yet) and the step it's on. */
function SweepBar({ line }: { line: string }) {
  return (
    <>
      <span className="rj-progress__track rj-progress__track--overall rj-progress__track--sweep mt-2 block" role="progressbar" aria-label="Starting" aria-valuetext={line} />
      <p className="mt-1.5 type-meta text-muted">{line}</p>
    </>
  );
}

/** The overall bar with "1,170 / 1,840 done" under it, and what's on the right ("about 50 min left"). */
function TotalBar({ done, total, right, paused, label }: { done: number; total: number; right?: string; paused?: boolean; label: string }) {
  return (
    <>
      <span
        className={cx("rj-progress__track rj-progress__track--overall mt-2 block", paused && "rj-progress__track--paused")}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done.toLocaleString()} of ${total.toLocaleString()} companies`}
      >
        <span className="rj-progress__fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </span>
      <p className="mt-1.5 flex justify-between gap-2 type-meta text-muted tabular">
        <span>
          {done.toLocaleString()} / {total.toLocaleString()} done
        </span>
        {right && <span>{right}</span>}
      </p>
    </>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="rj-steps">
      {steps.map((s) => (
        <li key={s.label} className="rj-steps__step" data-state={s.state}>
          <span className="rj-steps__icon" aria-hidden>
            {s.state === "done" ? <Check className="rj-icon" /> : s.state === "now" ? <LoaderCircle className="rj-icon animate-spin" /> : <span className="rj-steps__dot" />}
          </span>
          <span className="rj-steps__label">
            {s.label}
            <span className="sr-only">{s.state === "done" ? ": done" : s.state === "now" ? ": in progress" : ": next"}</span>
            {s.detail && <span className="rj-steps__detail">{s.detail}</span>}
          </span>
          <span className="rj-steps__time">{s.ms !== undefined ? took(s.ms) : ""}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Last checked Stripe · 2s ago", with a hint when nothing has finished for a while. */
function LastChecked({ last, lastAt, now, stalled }: { last?: string; lastAt?: number; now: number; stalled: string }) {
  if (!lastAt) return null;
  return (
    <>
      <p className="mt-3 flex min-w-0 items-center gap-2 type-meta text-muted">
        <span className="rj-pulse" aria-hidden />
        {last ? (
          <>
            Last checked <b className="truncate font-medium text-ink">{last}</b> · {ago(now - lastAt)}
          </>
        ) : (
          <>Last update {ago(now - lastAt)}</>
        )}
      </p>
      {now - lastAt > STALL_MS && (
        <p className="mt-2 flex gap-1.5 type-meta text-warning-text">
          <TriangleAlert className="size-3.5 flex-none translate-y-px" aria-hidden />
          {stalled}
        </p>
      )}
    </>
  );
}

/**
 * A running scan, in the header instead of a row across the page: a ring and the percent; hover,
 * focus or click it for the details (what it's checking, time left, progress by where the companies
 * come from, or per hiring system; matches so far, the Telegram message). Then the Telegram bell and
 * Stop (what's done is kept, and the next scan of the same type carries on).
 */
export function ScanStatus({ scan, onStop, notify, notifyLine }: { scan: ScanState; onStop: () => void; notify?: (openDetails: () => void) => ReactNode; notifyLine?: string }) {
  const { open, setOpen, rootProps, triggerProps } = useHoverDetails();
  const done = Math.min(scan.done, scan.total);
  const value = scan.syncing || !scan.total ? null : done / scan.total;
  const percent = value === null ? null : Math.floor(value * 100);
  const sources = sourceRows(scan);
  const bars = sources ? null : progressRows(scan);
  const found = Object.values(scan.results).reduce((n, h) => n + (h.ok ? h.matches : 0), 0);
  const label = scan.stopping ? "Stopping…" : scan.syncing ? "Updating…" : "Scanning";
  const now = useNow(!!open);
  const steps = scan.total ? null : startingSteps(scan, now);

  return (
    <div {...rootProps} className="relative flex items-center gap-1">
      <Button size="sm" {...triggerProps} aria-controls="scan-details" aria-label={`Scan ${percent === null ? "starting" : `${percent}% done`}: show details`}>
        <ProgressRing value={value} />
        <span className="max-sm:hidden">{label}</span>
        {percent !== null && <span className="tabular text-muted">{percent}%</span>}
      </Button>
      {notify?.(() => setOpen("pinned"))}
      <RjIconButton size="sm" label={scan.stopping ? "Stopping scan" : "Stop scan"} onClick={onStop} disabled={scan.stopping}>
        {scan.stopping ? <LoaderCircle className="rj-icon animate-spin" /> : <Square className="size-3 fill-current" />}
      </RjIconButton>
      {/* Says the scan is running or stopping; the percent itself isn't announced on every tick. */}
      <span className="sr-only" role="status">
        {scan.stopping ? "Stopping the scan" : "Scan running"}
      </span>

      {open && (
        <div
          id="scan-details"
          className="absolute right-0 top-full z-40 mt-2 flex max-h-[min(36rem,calc(100dvh-6rem))] w-[24rem] max-w-[calc(100vw-2rem)] flex-col rounded-md border border-line bg-raised p-4 shadow-l3 max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:w-auto max-sm:max-w-none"
        >
          {steps ? (
            <>
              <p className="flex justify-between gap-3 type-small font-semibold">
                Starting scan<span className="type-meta font-normal text-muted tabular">{clock(now - (scan.startedAt ?? now))}</span>
              </p>
              <SweepBar line={`Step ${steps.findIndex((s) => s.state === "now") + 1 || steps.length} of ${steps.length}`} />
              <Steps steps={steps} />
            </>
          ) : (
            <>
              <p className="type-small font-semibold">{scanLine(scan)}</p>
              {value !== null && <TotalBar done={done} total={scan.total} right={`${percent}%`} label="Scan progress" />}
              <LastChecked last={scan.last} lastAt={scan.lastAt} now={now} stalled="Some career sites are slow to answer. Still working; nothing's lost if you stop." />
              <div className="min-h-0 flex-1">
                <ScanBars
                  rows={sources ? sources.map((b) => ({ ...b, key: b.label })) : (bars ?? []).map((b) => ({ ...b, key: b.ats || "all", label: b.ats ? atsLabel(b.ats) : "All companies" }))}
                  noun={sources ? "source" : "hiring system"}
                  onExpand={() => setOpen("pinned")}
                />
              </div>
            </>
          )}
          {scan.total > 0 && (
            <p className="mt-3 border-t border-line pt-3 type-small text-muted">
              <b className="tabular font-semibold text-ink">{found.toLocaleString()}</b> {found === 1 ? "match" : "matches"} so far. Stop any time: the next scan carries on from here.
            </p>
          )}
          {notifyLine && <p className="mt-2 border-t border-line pt-2 type-small text-muted">{notifyLine}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The background check after Scan now: a small quiet pill ("Checking the rest 18%"). Hover, focus or
 * click it for the details: its steps while it starts, then progress, matches, failures and the
 * company it checked last; Pause. Paused, it stays as "Paused" with Resume now (it picks up where it
 * stopped, or after the next Scan now).
 */
export function BackgroundPill({ scan, bg, onPause, onResume }: { scan: ScanState; bg: Background; onPause: () => void; onResume: () => void }) {
  const { open, rootProps, triggerProps } = useHoverDetails();
  const now = useNow(!!open);
  const paused = !!bg.summary?.stopped;
  const done = Math.min(bg.done, bg.total);
  const value = bg.total ? done / bg.total : null;
  const percent = value === null ? null : Math.floor(value * 100);
  const label = bg.pausing ? "Pausing…" : paused ? "Paused" : "Checking the rest";
  const copy = <p className="type-small text-muted">We'll only tell you if it finds a match. Pause any time; it picks up where it stopped.</p>;
  const pause = (
    <Button size="sm" className="justify-self-start" onClick={onPause} disabled={bg.pausing}>
      {bg.pausing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />} Pause
    </Button>
  );
  return (
    <div {...rootProps} className="relative">
      <button
        type="button"
        {...triggerProps}
        aria-controls="background-details"
        aria-label={`Background check ${paused ? "paused" : percent === null ? "starting" : `${percent}% done`}: show details`}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 type-meta font-medium text-muted hover:text-ink"
      >
        {paused ? <Pause className="rj-icon" aria-hidden /> : <ProgressRing value={value} />}
        <span className="max-sm:hidden">{label}</span>
        {percent !== null && !paused && <span className="tabular">{percent}%</span>}
      </button>
      {open && (
        <div
          id="background-details"
          className="absolute right-0 top-full z-40 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-raised p-4 shadow-l3 max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:w-auto max-sm:max-w-none"
        >
          {paused ? (
            <>
              <p className="type-small font-semibold">Paused</p>
              {bg.total > 0 && <TotalBar done={done} total={bg.total} right="Paused" paused label="Background check progress" />}
              <div className="mt-3 grid gap-2 border-t border-line pt-3">
                <p className="type-small text-muted">
                  <b className="tabular font-semibold text-ink">{bg.found.toLocaleString()}</b> {bg.found === 1 ? "match" : "matches"} so far. It picks up where it stopped: now, or after your next
                  Scan now.
                </p>
                <Button size="sm" className="justify-self-start" onClick={onResume}>
                  <Play className="size-3.5" /> Resume now
                </Button>
              </div>
            </>
          ) : !bg.total ? (
            <>
              <p className="flex justify-between gap-3 type-small font-semibold">
                Checking every other company<span className="type-meta font-normal text-muted tabular">{clock(now - (bg.startedAt ?? now))}</span>
              </p>
              <SweepBar line="Getting ready" />
              <Steps steps={backgroundSteps(scan)} />
              <div className="mt-3 grid gap-2 border-t border-line pt-3">
                {copy}
                {pause}
              </div>
            </>
          ) : (
            <>
              <p className="type-small font-semibold">Checking the other {bg.total.toLocaleString()} companies</p>
              <TotalBar done={done} total={bg.total} right={backgroundLeft(bg)} label="Background check progress" />
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {(
                  [
                    [bg.found === 1 ? "Match" : "Matches", bg.found],
                    // This run's, like the matches and failures (a resumed check did the rest before).
                    ["Checked fine", Math.max(0, done - bg.resumed - bg.failed)],
                    ["Couldn't reach", bg.failed],
                  ] as const
                ).map(([k, n]) => (
                  <div key={k} className="flex flex-col-reverse justify-end rounded-md bg-inset px-2.5 py-2">
                    <dt className="type-meta text-muted">{k}</dt>
                    <dd className="type-body font-semibold tabular">{n.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <LastChecked last={bg.last} lastAt={bg.lastAt} now={now} stalled="Waiting on a slow career site. Still working; Pause any time." />
              <div className="mt-3 grid gap-2 border-t border-line pt-3">
                {copy}
                {pause}
              </div>
            </>
          )}
        </div>
      )}
      <span className="sr-only" role="status">
        {paused ? "Background check paused" : "Background check running"}
      </span>
    </div>
  );
}

/** Settings > Scans: what Scan now runs. Saved right away (on this computer too: KEPT_ON_DISK in lib/tracking.ts). */
export function ScanPrefsPicker({ plan }: { plan: ScanPlan | null }) {
  const prefs = useScanPrefs();
  const hints = scanHints(plan);
  const options: { id: "mine" | "yours"; label: string; recommended?: boolean }[] = [
    { id: "mine", label: "Scan", recommended: true },
    { id: "yours", label: "Only my companies" },
  ];
  return (
    <fieldset>
      <legend className="type-label">When I click Scan now</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const on = prefs.scope === o.id;
          return (
            <label key={o.id} className={cx("flex cursor-pointer items-center gap-2.5 rounded-md border p-3", on ? "border-ink bg-active" : "border-line hover:border-muted/50")}>
              <input type="radio" name="scan-now" checked={on} onChange={() => setScanPrefs({ scope: o.id })} className="accent-ink" />
              <span className="type-small">
                <b>{o.label}</b>
                {o.recommended && <span className="ml-1 type-meta text-muted">Recommended</span>}
                <span className="block text-muted">{hints[o.id]}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
