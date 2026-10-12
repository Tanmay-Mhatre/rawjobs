import { ChevronDown, LoaderCircle, RefreshCw, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { atsLabel } from "../lib/filters";
import { roughCount } from "../lib/format";
import { aboutTime, progressRows, SCOPE_LABEL, scanLine, scanPrefs, scopeLabel, setScanPrefs, useScanPrefs, type ScanState } from "../lib/scan";
import { scanPlan, type ScanPlan, type ScanScope } from "../lib/setup";
import { Dialog } from "./Dialog";
import { IconButton as RjIconButton, SourceTag } from "./primitives";
import { Button, Card, cx, IconButton } from "./ui";

const SCOPE_HINT: Record<ScanScope, string> = {
  mine: "Your companies, plus every company in the directory tagged with your industries.",
  all: "Every company in the directory that RawJobs can scan. Keep this computer on while it runs; you can stop it and carry on later.",
};

/**
 * "Scan now": asks which scan to run (preselecting your default), or, if you chose "don't ask
 * again", runs your default straight away. The arrow next to it always asks. While a scan runs it
 * becomes the scan's status (ScanStatus): progress, the Telegram bell, and Stop.
 */
export function ScanButton({
  scan,
  onRequest,
  onChoose,
  onStop,
  notify,
  notifyLine,
}: {
  scan: ScanState;
  onRequest: () => void;
  onChoose: () => void;
  onStop: () => void;
  /** The Telegram bell, given a way to open the scan details. */
  notify?: (openDetails: () => void) => ReactNode;
  /** What happens when the scan ends, for the details. */
  notifyLine?: string;
}) {
  const prefs = useScanPrefs();
  if (scan.phase === "running") return <ScanStatus scan={scan} onStop={onStop} notify={notify} notifyLine={notifyLine} />;
  return (
    <div className="inline-flex">
      <Button size="sm" className="rounded-r-0" onClick={onRequest} title={prefs.ask ? "Scan now: choose which scan" : `Scan now: ${SCOPE_LABEL[prefs.scope]}`}>
        <RefreshCw className="size-3.5" /> Scan now
      </Button>
      <Button size="sm" className="-ml-px rounded-l-0 px-1.5" onClick={onChoose} aria-label="Choose which scan to run" title="Choose which scan to run">
        <ChevronDown className="size-3.5" />
      </Button>
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

/**
 * A running scan, in the header instead of a row across the page: a ring and the percent; hover,
 * focus or click it for the details (what it's scanning, time left, progress per hiring system, matches
 * so far, the Telegram message). Then the Telegram bell and Stop (what's done is kept, and the next
 * scan of the same type carries on).
 */
export function ScanStatus({ scan, onStop, notify, notifyLine }: { scan: ScanState; onStop: () => void; notify?: (openDetails: () => void) => ReactNode; notifyLine?: string }) {
  /** "hover" follows the pointer and focus; "pinned" stays until clicked again, Esc, or a click elsewhere. */
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
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const done = Math.min(scan.done, scan.total);
  const value = scan.syncing || !scan.total ? null : done / scan.total;
  const percent = value === null ? null : Math.floor(value * 100);
  const bars = progressRows(scan);
  const found = Object.values(scan.results).reduce((n, h) => n + (h.ok ? h.matches : 0), 0);
  const label = scan.stopping ? "Stopping…" : scan.syncing ? "Updating…" : "Scanning";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover, focus or drop handling around real controls; nothing here is only reachable by mouse
    <div
      ref={root}
      className="relative flex items-center gap-1"
      onPointerEnter={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => o || "hover"), 120)}
      onPointerLeave={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => (o === "hover" ? false : o)), 200)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen((o) => (o === "hover" ? false : o))}
    >
      <Button
        size="sm"
        onClick={() => setOpen((o) => (o === "pinned" ? false : "pinned"))}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setOpen((o) => o || "hover")}
        aria-expanded={!!open}
        aria-controls="scan-details"
        aria-label={`Scan ${percent === null ? "starting" : `${percent}% done`}: show details`}
      >
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
        <div id="scan-details" className="absolute right-0 top-full z-40 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-raised p-4 shadow-l3">
          <p className="type-small font-medium">{scanLine(scan)}</p>
          {bars.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: the native element (fieldset, output, input, hr, ul) would change layout or behaviour here
            <div className="rj-progress mt-3" role="group" aria-label="Scan progress">
              {bars.map((b) => (
                <div key={b.ats || "all"} className="rj-progress__row">
                  <SourceTag source={b.ats ? atsLabel(b.ats) : "All companies"} className="min-w-0 truncate" />
                  <span className="rj-progress__track">
                    <span className="rj-progress__fill" style={{ transform: `scaleX(${b.total ? b.done / b.total : 0})` }} />
                  </span>
                  <span className="rj-progress__count">
                    {b.done.toLocaleString()} / {b.total.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
          {scan.total > 0 && (
            <p className="mt-3 type-small text-muted">
              <b className="tabular font-semibold text-ink">{found.toLocaleString()}</b> matching {found === 1 ? "job" : "jobs"} so far. Stop any time: the next scan carries on from here.
            </p>
          )}
          {notifyLine && <p className="mt-2 border-t border-line pt-2 type-small text-muted">{notifyLine}</p>}
        </div>
      )}
    </div>
  );
}

/** The "which scan?" pop-up. What you start becomes your default; tick the box to stop being asked. */
export function ScanChooser({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (scope: ScanScope) => void }) {
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const [scope, setScope] = useState<ScanScope>("mine");
  const [always, setAlways] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p = scanPrefs();
    setScope(p.scope);
    setAlways(!p.ask);
    void scanPlan().then(setPlan);
  }, [open]);

  const start = () => {
    setScanPrefs({ scope, ask: !always });
    onClose();
    onStart(scope);
  };
  // No industry companies on top of yours: the "mine" scan is just My companies.
  const hasIndustries = !plan || plan.mine.extra > 0;

  return (
    <Dialog open={open} onClose={onClose} labelledBy="scan-chooser-title" placement="bottom" initialFocus="[data-autofocus]">
      <Card className="relative p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="scan-chooser-title" className="type-subheading font-semibold">
              Which scan?
            </h2>
            <p className="mt-0.5 type-small text-muted">Both update the company directory first, then scan each company live for new jobs.</p>
          </div>
          <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div role="radiogroup" aria-label="Scan type" className="mt-4 space-y-2">
          {(["mine", "all"] as const).map((s) => {
            const p = plan?.[s];
            const count = p ? p.yours + p.extra : 0;
            return (
              <label key={s} className={cx("flex cursor-pointer gap-3 rounded-md border p-3.5 transition-colors", scope === s ? "border-ink bg-active" : "border-line hover:border-muted/50")}>
                <input type="radio" name="scan-scope" checked={scope === s} onChange={() => setScope(s)} className="mt-1 accent-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block type-small font-semibold">{scopeLabel(s, hasIndustries)}</span>
                  <span className="block type-small text-muted">{s === "mine" && !hasIndustries ? "The companies you've added. Add industries in Settings to scan more." : SCOPE_HINT[s]}</span>
                  <span className="mt-1.5 block type-small font-medium tabular">
                    {p ? `${s === "all" ? roughCount(count) : count.toLocaleString()} companies · ${aboutTime(p.seconds)}` : <LoaderCircle className="inline size-3 animate-spin text-muted" />}
                  </span>
                  {p?.resumable && <span className="mt-0.5 block type-small text-ink">Carries on a stopped scan ({p.resumable.done.toLocaleString()} done)</span>}
                </span>
              </label>
            );
          })}
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 type-small">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
          <span>
            Always run this scan, don't ask again
            <span className="block type-small text-muted">
              Change it any time with the arrow <ChevronDown aria-hidden="true" size={16} className="inline-block align-text-bottom" /> next to Scan now, or in Settings.
            </span>
          </span>
        </label>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} data-autofocus>
            <RefreshCw className="size-4" /> Start scan
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}

/** Settings: what "Scan now" does. Saved right away (in this browser). */
export function ScanPrefsPicker() {
  const prefs = useScanPrefs();
  const options: { id: string; label: string; hint: string; on: boolean; pick: () => void }[] = [
    { id: "ask", label: "Ask me every time", hint: `Your last choice is preselected (now: ${SCOPE_LABEL[prefs.scope]}).`, on: prefs.ask, pick: () => setScanPrefs({ ask: true }) },
    ...(["mine", "all"] as const).map((s) => ({
      id: s,
      label: `Always: ${SCOPE_LABEL[s]}`,
      hint: s === "mine" ? "Starts straight away, a few minutes." : "Starts straight away. Minutes with the daily job feed, up to 2 hours without it.",
      on: !prefs.ask && prefs.scope === s,
      pick: () => setScanPrefs({ ask: false, scope: s }),
    })),
  ];
  return (
    <fieldset>
      <legend className="type-label">When I click Scan now</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label key={o.id} className={cx("flex cursor-pointer gap-2.5 rounded-md border p-3", o.on ? "border-ink bg-active" : "border-line hover:border-muted/50")}>
            <input type="radio" name="scan-now" checked={o.on} onChange={o.pick} className="mt-0.5 accent-ink" />
            <span className="type-small">
              <b>{o.label}</b>
              <span className="block text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
