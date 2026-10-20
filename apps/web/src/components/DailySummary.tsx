import { CircleAlert, LoaderCircle, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type DailySummaryStatus, dailySummaryStatus, removeDailySummary, saveDailySummary, testDailySummary } from "../lib/automation";
import { today } from "../lib/userState";
import { Button, Select, Toggle } from "./ui";

/** Morning times, every 30 minutes from 05:00 to 11:30: a scheduled run after noon sends nothing. */
export const DAILY_TIMES = Array.from({ length: 14 }, (_, i) => `${String(5 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const DEFAULT_TIME = "09:00";

type Kind = "on" | "off" | "time" | "test";

/** What failed, and how to fix it. The raw reason goes under "Technical details". */
const FAILED: Record<Kind, string> = {
  on: "Couldn't turn on the daily summary. Your computer's task scheduler didn't accept it. Try again; if it keeps failing, restart RawJobs.",
  off: "Couldn't turn off the daily summary. Try again; if it keeps failing, restart RawJobs.",
  time: "Couldn't change the time. Try again; if it keeps failing, restart RawJobs.",
  test: "Couldn't send the test message. Check your internet connection and try again.",
};

type Note = { tone: "ok" | "bad"; text: string; detail?: string; retry?: () => void };

/** "9:00" from an ISO time, local. */
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** The status line: what happened today. Exported for tests. */
export function dailyLine(s: Pick<DailySummaryStatus, "installed" | "last">, now = new Date()): string | undefined {
  // Only while it's on: a send from before you turned it off would read as if it were still running.
  if (!s.installed) return undefined;
  const last = s.last?.day === today(now) ? s.last : null;
  if (last?.result === "sent") return `Last sent today at ${clock(last.at)}.`;
  if (last?.result === "nothing-due") return "Nothing was due today.";
  return "Not sent yet today.";
}

/**
 * "Today in your Pipeline" on Telegram each morning: interviews, offers to answer, thank-yous and
 * follow-ups due. Its own task in this computer's scheduler, apart from scheduled scans; off until you
 * turn it on. `refresh` changes when Telegram is connected or disconnected above it.
 */
export function DailySummary({ refresh = 0 }: { refresh?: number }) {
  const [status, setStatus] = useState<DailySummaryStatus | null>(null);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const load = useCallback(async () => {
    const s = await dailySummaryStatus();
    setStatus(s);
    if (s.settings) setTime(s.settings.time);
  }, []);
  useEffect(() => {
    void refresh;
    void load();
  }, [load, refresh]);

  const run = async (kind: Kind, value = time) => {
    setBusy(kind);
    setNote(null);
    try {
      const r = kind === "test" ? await testDailySummary() : kind === "off" ? await removeDailySummary() : await saveDailySummary(value);
      if (!r.ok) setNote({ tone: "bad", text: FAILED[kind], detail: r.error, retry: () => void run(kind, value) });
      else
        setNote({
          tone: "ok",
          text: kind === "test" ? "Sent. Check Telegram." : kind === "off" ? "The daily summary is off." : `Saved. It comes at ${value} on days something is due.`,
        });
      if (kind !== "test") await load();
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
  if (status.error && !status.supported)
    return (
      <div className="type-small" role="alert">
        <p className="text-danger-text">Couldn't check the daily summary. Make sure RawJobs is running on this computer, then try again.</p>
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => void load()}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      </div>
    );
  if (!status.supported) return <p className="type-small text-muted">The daily summary isn't supported on this system yet.</p>;

  const ready = status.telegram;
  const line = dailyLine(status);

  return (
    <div className="space-y-3">
      {status.problem && (
        <p className="flex items-start gap-2 rounded-md bg-warning-subtle/50 p-3 type-small text-warning-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {status.problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle checked={status.installed} disabled={(!ready && !status.installed) || !!busy} onChange={(on) => void run(on ? "on" : "off")}>
          Daily summary of today's tasks
        </Toggle>
        <span className="inline-flex items-center gap-2 type-small text-muted">
          <label htmlFor="daily-summary-time">At</label>
          <Select
            id="daily-summary-time"
            value={time}
            disabled={!ready || !!busy}
            onChange={(e) => {
              setTime(e.target.value);
              if (status.installed) void run("time", e.target.value);
            }}
          >
            {DAILY_TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </span>
        {busy && busy !== "test" && <LoaderCircle className="size-4 animate-spin text-muted" aria-label="Saving" />}
      </div>
      {!ready ? (
        <p className="type-small text-muted">Set up Telegram first, above. Then you can turn this on.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" onClick={() => void run("test")} disabled={!!busy}>
            {busy === "test" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send a test now
          </Button>
          {line && <span className="type-small text-muted">{line}</span>}
        </div>
      )}
      {note && (
        <div role={note.tone === "bad" ? "alert" : "status"} className="type-small">
          <p className={note.tone === "bad" ? "text-danger-text" : "text-success-text"}>{note.text}</p>
          {note.retry && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={note.retry} disabled={!!busy}>
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
      <p className="type-small text-muted">
        One message a morning, only on days something is due. Includes job titles and company names, never people or notes. If your computer is off at that time, it comes when the computer is back on,
        until noon.
      </p>
    </div>
  );
}
