import { CircleAlert, CloudDownload, Copy, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "../lib/format";
import {
  announceUpdateStatus,
  checkForUpdate,
  installLine,
  markUpdateSeen,
  saveUpdateSettings,
  updateNow,
  useServerHealth,
  useUpdateStatus,
  type UpdateStatus,
} from "../lib/update";
import { toast } from "./Toast";
import { Button, cx } from "./ui";

/** Release notes, as plain lines (they come from the release's tag message). */
function Notes({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <details className="mt-1 type-small">
      <summary className="cursor-pointer text-muted">What's new</summary>
      <div className="mt-1 space-y-1 whitespace-pre-wrap text-ink">{text.trim()}</div>
    </details>
  );
}

function CopyInstallLine() {
  const line = installLine();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-sm bg-inset px-2 py-1 font-mono type-meta">{line}</code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void navigator.clipboard?.writeText(line).then(() => toast({ message: "Copied the install line" }))}
      >
        <Copy className="size-3.5" /> Copy
      </Button>
    </div>
  );
}

/**
 * Above the page, on an installed copy: "RawJobs is restarting" while the server is away (the page
 * reloads by itself when it's back as a new version), then how the last update went, a new version
 * waiting for you (updates on Ask me, or a new major version), or that this one is too old to update.
 */
export function ServerNotices() {
  const { down } = useServerHealth();
  const { status, setStatus, refresh } = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  // Back after a restart as the same version (an update that went back): read how it went.
  const wasDown = useRef(false);
  useEffect(() => {
    if (wasDown.current && !down) void refresh();
    wasDown.current = down;
  }, [down, refresh]);

  if (down) {
    return (
      <div role="status" className="mb-3 flex items-center gap-2 rounded-md bg-inset/60 px-3 py-2 type-small">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" aria-hidden />
        <span>
          <b>Reconnecting to RawJobs…</b> <span className="text-muted">It's restarting (after an update, this takes a few seconds). The page reloads by itself.</span>
        </span>
      </div>
    );
  }
  if (!status?.installed) return null;

  const seen = async () => {
    const s = await markUpdateSeen();
    if (s) setStatus(s);
  };
  const update = async () => {
    setBusy(true);
    const s = await updateNow();
    if (s) setStatus(s);
    setBusy(false);
  };

  const last = status.lastUpdate;
  if (last) {
    return (
      <div role={last.ok ? "status" : "alert"} className={cx("mb-3 flex items-start gap-2 rounded-md px-3 py-2 type-small", last.ok ? "bg-inset/60" : "bg-warning-subtle/50 text-warning-text")}>
        {last.ok ? <CloudDownload className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">
          {last.ok ? (
            <>
              <p>
                <b>Updated to RawJobs {last.to}.</b>
              </p>
              <Notes text={last.notes ?? ""} />
            </>
          ) : (
            <p>
              <b>The update to {last.to} didn't work, so you're still on {last.from}.</b> Nothing of yours changed. RawJobs won't try that version again by itself.
            </p>
          )}
        </div>
        <button type="button" aria-label="Dismiss" title="Dismiss" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink" onClick={() => void seen()}>
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (status.tooOld) {
    return (
      <div role="status" className="mb-3 rounded-md bg-inset/60 px-3 py-2 type-small">
        <p>
          <b>A new RawJobs is out, and this version is too old to update by itself.</b> <span className="text-muted">Run the install line again; your data stays.</span>
        </p>
        <CopyInstallLine />
      </div>
    );
  }

  const a = status.available;
  const waiting = a && (status.settings.mode === "ask" || a.major || status.state === "updating");
  if (!a || !waiting) return null;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md bg-inset/60 px-3 py-2 type-small">
      <CloudDownload className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          <b>RawJobs {a.version} is ready to install.</b> <span className="text-muted">It takes a few seconds; your data stays.</span>
        </p>
        <Notes text={a.notes} />
        {status.error && <p className="mt-1 text-danger-text">{status.error}</p>}
      </div>
      <Button size="sm" variant="primary" onClick={() => void update()} disabled={busy || status.state !== "idle"}>
        {busy || status.state === "updating" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {status.state === "updating" ? "Updating…" : "Update now"}
      </Button>
    </div>
  );
}

const MODES: { id: UpdateStatus["settings"]["mode"]; label: string; hint: string }[] = [
  { id: "auto", label: "Automatic", hint: "New versions install by themselves when no scan is running. A new major version asks first." },
  { id: "ask", label: "Ask me", hint: "Show new versions, and install when you say. Urgent fixes still install by themselves." },
  { id: "off", label: "Off", hint: "Never check. Run the install line again to update." },
];

/** Settings → Updates. */
export function UpdatesSettings() {
  const { status, setStatus } = useUpdateStatus();
  const [busy, setBusy] = useState<"check" | "update" | null>(null);

  if (!status) return <p className="flex items-center gap-2 type-small text-muted"><LoaderCircle className="size-4 animate-spin" /> Checking…</p>;
  if (!status.installed) {
    return (
      <p className="type-small text-muted">
        You're running RawJobs {status.current} from its source code, which updates with <code className="font-mono">git pull</code>. Installed copies (from the install line) update by themselves.
      </p>
    );
  }

  const apply = (s: UpdateStatus | null) => {
    if (s) setStatus(s);
    announceUpdateStatus();
  };
  const run = async (kind: "check" | "update") => {
    setBusy(kind);
    apply(kind === "check" ? await checkForUpdate() : await updateNow());
    setBusy(null);
  };

  const a = status.available;
  return (
    <div className="space-y-4">
      <p className="type-small">
        You have RawJobs <b>{status.current}</b>.{" "}
        <span className="text-muted">
          {a ? `RawJobs ${a.version} is out.` : status.lastCheck ? `That's the newest version (checked ${timeAgo(status.lastCheck)}).` : "Not checked yet."}
        </span>
      </p>
      <fieldset>
        <legend className="type-label">New versions</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.id} className={cx("flex cursor-pointer gap-2.5 rounded-md border p-3", status.settings.mode === m.id ? "border-ink bg-active" : "border-line")}>
              <input type="radio" name="update-mode" checked={status.settings.mode === m.id} onChange={() => void saveUpdateSettings({ mode: m.id }).then(apply)} className="mt-0.5 accent-ink" />
              <span className="type-small">
                <b>{m.label}</b>
                <span className="block text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 type-small">
        <input
          type="checkbox"
          checked={status.settings.channel === "beta"}
          onChange={(e) => void saveUpdateSettings({ channel: e.target.checked ? "beta" : "stable" }).then(apply)}
          className="mt-0.5 accent-ink"
        />
        <span>
          Get test versions early <span className="text-muted">(beta: newer, and more likely to have problems)</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run("check")} disabled={!!busy || status.state !== "idle"}>
          {busy === "check" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check now
        </Button>
        {a && (
          <Button variant="primary" onClick={() => void run("update")} disabled={!!busy || status.state !== "idle"}>
            {busy === "update" || status.state === "updating" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} Update to {a.version}
          </Button>
        )}
      </div>
      {status.error && (
        <p role="alert" className="type-small text-danger-text">
          {status.error}
        </p>
      )}
      <p className="type-small text-muted">Updates come from RawJobs' GitHub releases and are checked against its signing key before they install. Your profile, tracking and scan data are backed up first.</p>
    </div>
  );
}
