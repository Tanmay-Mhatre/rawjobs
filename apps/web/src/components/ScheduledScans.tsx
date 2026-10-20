import { CircleAlert, Clock, LoaderCircle, Plus, Power, Play, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { removeSchedule, runScheduleNow, saveSchedule, scheduleStatus, type ScheduledRun, type ScheduleStatus } from "../lib/automation";
import { formatDateTime, timeAgo } from "../lib/format";
import { aboutTime, scopeLabel } from "../lib/scan";
import { scanPlan, type ScanPlan, type ScanScope } from "../lib/setup";
import { toast } from "./Toast";
import { Button, cx } from "./ui";

const NOTIFIED: Record<string, string> = { sent: "sent to Telegram", "nothing-new": "nothing new to send", off: "Telegram not set up" };

const SKIPPED = "Another scan was already running.";

/** Why a run failed, in plain words, from its raw error. The raw error stays under "Technical details". */
const REASONS: [RegExp, string][] = [
  [
    /\b(EPERM|EBUSY|EACCES)\b/,
    "Another program, often antivirus or a backup app, was using RawJobs' files when the scan tried to save. Your earlier results are safe. It tries again at the next scheduled time, or press Scan now.",
  ],
  [/\bENOSPC\b/, "Your disk is full. Free up some space, then press Scan now."],
  [/\b(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b|fetch failed/, "No internet connection during the scan. It tries again at the next scheduled time."],
];

/** One history row's text. Exported for tests. */
export function runLine(r: ScheduledRun): string {
  if (!r.ok) {
    if (r.error === SKIPPED) return "Skipped. Another scan was already running.";
    const reason = REASONS.find(([pattern]) => pattern.test(r.error ?? ""))?.[1];
    return reason ? `Didn't finish. ${reason}` : "Didn't finish. It runs again at the next scheduled time.";
  }
  const parts = [`${r.matches ?? 0} matches, ${r.newMatches ?? 0} new`];
  if (r.notified) parts.push(NOTIFIED[r.notified] ?? r.notified);
  if (r.stopped) parts.push("stopped early");
  return parts.join(" · ");
}

type Kind = "save" | "remove" | "run";

/** What failed, and how to fix it. The raw reason goes under "Technical details". */
const FAILED: Record<Kind, string> = {
  save: "Couldn't save the schedule. Your computer's task scheduler didn't accept it. Try again; if it keeps failing, restart RawJobs.",
  remove: "Couldn't turn off scheduled scans. Try again; if it keeps failing, restart RawJobs.",
  run: "Couldn't start the scan. Try again in a moment.",
};

type Note = { tone: "ok" | "bad"; text: string; detail?: string; retry?: Kind };

/**
 * Scans on a timer, run by this computer's own scheduler (Task Scheduler on Windows), so they
 * happen with the dashboard closed. They need the computer on (or asleep).
 */
export function ScheduledScans() {
  const [status, setStatus] = useState<ScheduleStatus | null>(null);
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [scope, setScope] = useState<ScanScope>("mine");
  const [busy, setBusy] = useState<Kind | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const refresh = useCallback(async () => {
    const s = await scheduleStatus();
    setStatus(s);
    if (s.settings) {
      setTimes(s.settings.times);
      // "All companies" from before is the scan now: its background check covers every other company.
      setScope(s.settings.scope === "all" ? "mine" : s.settings.scope);
    }
  }, []);
  useEffect(() => {
    void refresh();
    void scanPlan().then(setPlan);
  }, [refresh]);

  const run = async (kind: Kind) => {
    setBusy(kind);
    setNote(null);
    // Turning off can be undone by installing the same schedule again.
    const previous = status?.installed ? status.settings : undefined;
    try {
      const s = kind === "save" ? await saveSchedule(times, scope) : kind === "remove" ? await removeSchedule() : await runScheduleNow();
      if (!s.ok) setNote({ tone: "bad", text: FAILED[kind], detail: s.error, retry: kind });
      else if (kind === "remove") {
        setNote({ tone: "ok", text: "Scheduled scans are off." });
        if (previous)
          toast({
            message: "Scheduled scans turned off.",
            actionLabel: "Undo",
            onAction: () =>
              void saveSchedule(previous.times, previous.scope).then(async (r) => {
                // An error that needs action stays inline, next to the schedule, not in a toast.
                if (!r.ok) setNote({ tone: "bad", text: "Couldn't turn scheduled scans back on. Save the schedule below to turn them on again.", detail: r.error });
                else setNote({ tone: "ok", text: "Scheduled scans are back on." });
                await refresh();
              }),
          });
      } else
        setNote({
          tone: "ok",
          text: kind === "save" ? "Saved. Your computer will scan at these times." : "Started. It runs in the background; the result shows below when it's done.",
        });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!status)
    return (
      <p className="flex items-center gap-2 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Checking…
      </p>
    );
  if (!status.supported) return <p className="type-small text-muted">Scheduled scans aren't supported on this system yet.</p>;

  const saved = status.settings;
  const changed = !saved || saved.times.join() !== [...times].sort().join() || saved.scope !== scope;
  // No industry companies on top of yours: the "mine" scan is just My companies.
  const hasIndustries = !plan || plan.mine.extra > 0;

  return (
    <div className="space-y-4">
      {status.installed && saved ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-inset p-3 type-small">
          <Clock className="size-4 text-muted" aria-hidden="true" />
          <span>
            On: <b>{scopeLabel(saved.scope, hasIndustries)}</b>, daily at <b>{saved.times.join(" and ")}</b>.{status.nextRun && <> Next scan {formatDateTime(status.nextRun)}.</>}
          </span>
        </div>
      ) : (
        status.problem && (
          <p className="flex items-start gap-2 rounded-md bg-warning-subtle/50 p-3 type-small text-warning-text">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {status.problem}
          </p>
        )
      )}

      <div className="space-y-3">
        <fieldset>
          <legend className="type-label">When</legend>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {times.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
              <span key={i} className="inline-flex items-center gap-1">
                <input
                  type="time"
                  value={t}
                  onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={`Scan time ${i + 1}`}
                  className="h-9 rounded-md border border-line bg-raised px-2 type-small"
                />
                {times.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    title="Remove this time"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
                    onClick={() => setTimes(times.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </span>
            ))}
            {times.length < 2 && (
              <Button size="sm" variant="ghost" onClick={() => setTimes([...times, times[0] === "20:00" ? "08:00" : "20:00"])}>
                <Plus className="size-3.5" /> Twice a day
              </Button>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend className="type-label">What to scan</legend>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {(["mine", "yours"] as const).map((s) => {
              const p = plan?.[s];
              const count = p ? p.yours + p.extra : 0;
              return (
                <label key={s} className={cx("flex cursor-pointer gap-2.5 rounded-md border p-3", scope === s ? "border-ink bg-active" : "border-line")}>
                  <input type="radio" name="schedule-scope" checked={scope === s} onChange={() => setScope(s)} className="mt-0.5 accent-ink" />
                  <span className="type-small">
                    <b>{scopeLabel(s, hasIndustries)}</b>
                    <span className="block text-muted">{p ? `${count.toLocaleString()} companies · ${aboutTime(p.seconds)}` : "…"}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void run("save")} disabled={!!busy || (status.installed && !changed)}>
            {busy === "save" && <LoaderCircle className="size-3.5 animate-spin" />}
            {status.installed ? "Save changes" : "Turn on scheduled scans"}
          </Button>
          {status.installed && (
            <>
              <Button onClick={() => void run("run")} disabled={!!busy}>
                {busy === "run" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Scan now
              </Button>
              <Button variant="ghost" onClick={() => void run("remove")} disabled={!!busy}>
                <Power className="size-3.5" /> Turn off
              </Button>
            </>
          )}
        </div>
        {note && (
          <div role={note.tone === "bad" ? "alert" : "status"} className="type-small">
            <p className={note.tone === "bad" ? "text-danger-text" : "text-success-text"}>{note.text}</p>
            {note.retry && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => void run(note.retry!)} disabled={!!busy}>
                <RefreshCw className="size-3.5" /> Try again
              </Button>
            )}
            {note.detail && (
              <details className="mt-1 type-meta text-muted">
                <summary className="cursor-pointer">Technical details</summary>
                <p className="mt-1 whitespace-pre-wrap font-mono">{note.detail}</p>
              </details>
            )}
          </div>
        )}
      </div>

      <p className="type-small text-muted">
        Scans run on this computer, even with this page closed, but only while it's on or asleep (it wakes up for them). A scan missed while it was off runs as soon as it's back on.
      </p>

      {status.runs.length > 0 && (
        <div>
          <p className="type-label">Recent scheduled scans</p>
          <ul className="mt-1.5 divide-y divide-line rounded-md border border-line type-small">
            {status.runs.slice(0, 5).map((r) => (
              <li key={r.startedAt} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="w-32 shrink-0 text-muted" title={formatDateTime(r.startedAt)}>
                  {timeAgo(r.startedAt)}
                </span>
                <span className={cx("min-w-0 flex-1", !r.ok && r.error !== SKIPPED && "text-danger-text")}>
                  {runLine(r)}
                  {!r.ok && r.error && r.error !== SKIPPED && (
                    <details className="type-meta text-muted">
                      <summary className="cursor-pointer">Technical details</summary>
                      <span className="mt-1 block whitespace-pre-wrap font-mono">{r.error}</span>
                    </details>
                  )}
                </span>
                <span className="text-muted">{scopeLabel(r.scope, hasIndustries)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
