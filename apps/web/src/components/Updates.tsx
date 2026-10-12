import type { ReleaseChange } from "@rawjobs/core/release-notes";
import { CircleAlert, Copy, ExternalLink, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, timeAgo } from "../lib/format";
import {
  announceUpdateStatus,
  checkForUpdate,
  installLine,
  ISSUES_URL,
  markUpdateSeen,
  RELEASES_URL,
  saveUpdateSettings,
  updateNow,
  useServerHealth,
  useUpdateStatus,
  type UpdateStatus,
} from "../lib/update";
import { DesktopShortcutNotice, Row } from "./DesktopShortcut";
import { RequiredUpdate } from "./RequiredUpdate";
import { toast } from "./Toast";
import { Button, Toggle } from "./ui";
import { ReleaseList, WhatsNewDialog } from "./WhatsNew";

/** A release's notes, folded: its New / Improved / Fixed lines (WhatsNew.tsx). */
function Notes({ notes, changes }: { notes: string; changes?: ReleaseChange[] }) {
  if (!notes.trim() && !changes?.length) return null;
  return (
    <details className="mt-1 type-small">
      <summary className="cursor-pointer text-muted">What's new</summary>
      <div className="mt-2 max-h-60 overflow-y-auto">
        <ReleaseList notes={notes} changes={changes} />
      </div>
    </details>
  );
}

function CopyInstallLine() {
  const line = installLine();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-sm bg-inset px-2 py-1 font-mono type-meta">{line}</code>
      <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(line).then(() => toast({ message: "Copied the install line" }))}>
        <Copy className="size-3.5" /> Copy
      </Button>
    </div>
  );
}

/** The Update button, saying what's happening: waiting for a scan, updating. */
function UpdateButton({ status, onClick, busy, label }: { status: UpdateStatus; onClick: () => void; busy: boolean; label: string }) {
  const working = busy || status.state === "updating" || status.state === "waiting";
  return (
    <Button size="sm" variant="primary" onClick={onClick} disabled={working || status.state === "checking"}>
      {working ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {status.state === "waiting" ? "Waiting for the scan…" : status.state === "updating" ? "Updating…" : label}
    </Button>
  );
}

/**
 * Above the page, on an installed copy: "RawJobs is restarting" while the server is away (the page
 * reloads by itself when it's back as a new version), then, once after an update, "What's new"
 * (WhatsNewDialog), or a note when an update didn't work. A new version waiting shows as the Update
 * pill in the header (UpdatePill), not here. A required update, or a version too old to update by
 * itself, comes up in a window instead (RequiredUpdate). The first time you land on the Radar,
 * once per computer, a popup says where the RawJobs shortcuts are (DesktopShortcutNotice); never on
 * top of another window or after an update that didn't work.
 */
export function ServerNotices({ onRadar = false }: { onRadar?: boolean }) {
  const { down } = useServerHealth();
  const { status, setStatus, refresh } = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  // Back after a restart as the same version (an update that went back): read how it went.
  const wasDown = useRef(false);
  useEffect(() => {
    if (wasDown.current && !down) void refresh();
    wasDown.current = down;
  }, [down, refresh]);
  // While it waits for a scan or restarts, follow along.
  useEffect(() => {
    if (status?.state !== "waiting" && status?.state !== "updating") return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [status?.state, refresh]);

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

  const update = async () => {
    setBusy(true);
    const s = await updateNow();
    if (s) setStatus(s);
    setBusy(false);
    // The header's Update pill shows "Update after scan" when it's waiting for one.
    announceUpdateStatus();
    return s;
  };
  const required = !!status.available?.critical || status.tooOld;
  const last = status.lastUpdate;

  // One window at a time: a required update first, then What's new, then the shortcut popup.
  if (required) return <RequiredUpdate status={status} update={update} busy={busy} />;
  if (last?.ok) return <WhatsNewDialog from={last.from} to={last.to} notes={last.notes} onSeen={(s) => s && setStatus(s)} />;
  const intro = onRadar && last?.ok !== false && status.about?.shortcuts?.notice ? <DesktopShortcutNotice status={status} onSeen={(s) => s && setStatus(s)} /> : null;
  if (!last) return intro;

  const seen = async () => {
    const s = await markUpdateSeen();
    if (s) setStatus(s);
  };
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded-md bg-warning-subtle/50 px-3 py-2 type-small text-warning-text">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>
          The update to {last.to} didn't work, so you're still on {last.from}.
        </b>{" "}
        Nothing of yours changed. RawJobs won't offer that version again.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
        onClick={() => void seen()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Settings → About: whether to hear about new versions, and which ones. */
export function UpdatesSettings() {
  const { status, setStatus } = useUpdateStatus();
  if (!status?.installed) return null;
  const apply = (s: UpdateStatus | null) => {
    if (s) setStatus(s);
    announceUpdateStatus();
  };
  return (
    <div className="space-y-3">
      <Toggle checked={status.settings.mode !== "off"} onChange={(on) => void saveUpdateSettings({ mode: on ? "ask" : "off" }).then(apply)}>
        Watch for new versions
      </Toggle>
      <p className="type-small text-muted">
        Every few minutes RawJobs looks whether a new version is out. When one is, it's downloaded in the background and checked against RawJobs' signing key, then an Update button appears at the top.
        It only installs when you click it. A required fix asks until you update.
      </p>
      <Toggle checked={status.settings.telegram !== false} onChange={(on) => void saveUpdateSettings({ telegram: on }).then(apply)}>
        Tell me on Telegram when an update is ready
      </Toggle>
      <p className="type-small text-muted">Only if Telegram alerts are set up and on (Scans and alerts). One message per version.</p>
      <Toggle checked={status.settings.channel === "beta"} onChange={(on) => void saveUpdateSettings({ channel: on ? "beta" : "stable" }).then(apply)}>
        Get test versions early (beta: newer, and more likely to have problems)
      </Toggle>
    </div>
  );
}

const linkClass = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 type-small text-muted hover:bg-inset hover:text-ink";

/** Settings → About: which version this is, since when, what's newer, and where everything is. */
export function AboutRawJobs() {
  const { status, setStatus } = useUpdateStatus();
  const [busy, setBusy] = useState<"check" | "update" | null>(null);

  if (!status)
    return (
      <p className="flex items-center gap-2 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Loading…
      </p>
    );
  if (!status.installed) {
    return (
      <dl className="divide-y divide-line">
        <Row label="Version">RawJobs {status.current}</Row>
        <Row label="Updates">
          This copy runs from the source code and updates with <code className="font-mono">git pull</code>. Installed copies (from the install line) update from here.
        </Row>
      </dl>
    );
  }

  const run = async (kind: "check" | "update") => {
    setBusy(kind);
    const s = kind === "check" ? await checkForUpdate() : await updateNow();
    if (s) setStatus(s);
    announceUpdateStatus();
    setBusy(null);
  };

  const a = status.available;
  const about = status.about;
  let latest: ReactNode = "Not checked yet.";
  if (a)
    latest = (
      <span>
        <b>RawJobs {a.version}</b> is out{a.date ? `, from ${formatDate(a.date)}` : ""}.{a.critical && <b className="text-warning-text"> Required update.</b>}
      </span>
    );
  else if (status.lastCheck) latest = "You have the newest version.";

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line">
        <Row label="Version">
          <b>RawJobs {status.current}</b>
        </Row>
        {about?.since && <Row label={about.since.by === "update" ? "Updated on" : "Installed on"}>{formatDate(about.since.at)}</Row>}
        <Row label="Latest version">
          {latest}
          {a && <Notes notes={a.notes} changes={a.changes} />}
        </Row>
        <Row label="Last checked">
          {status.settings.mode === "off" ? "Checking is off (Updates, below)." : status.lastCheck ? `${timeAgo(status.lastCheck)}, ${formatDate(status.lastCheck)}` : "Not yet"}
        </Row>
        {about && (
          <>
            <Row label="Your RawJobs folder">
              <code className="break-all font-mono">{about.home}</code>
              <span className="block text-muted">Your profile, data and settings. Before each update they're copied to its backups folder (the last three are kept).</span>
            </Row>
            <Row label="Runs on">
              Node {about.node}, {about.platform}
            </Row>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run("check")} disabled={!!busy || status.state !== "idle"}>
          {busy === "check" || status.state === "checking" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check for updates
        </Button>
        {a && !status.tooOld && <UpdateButton status={status} onClick={() => void run("update")} busy={busy === "update"} label={`Update to ${a.version}`} />}
        <a className={linkClass} href={RELEASES_URL} target="_blank" rel="noreferrer">
          All releases <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <a className={linkClass} href={ISSUES_URL} target="_blank" rel="noreferrer">
          Report a problem <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      {status.state === "waiting" && <p className="type-small text-muted">A scan is running: RawJobs updates as soon as it's done.</p>}
      {status.tooOld && (
        <div className="type-small">
          <p>This version is too old to update by itself. Run the install line again; your data stays.</p>
          <CopyInstallLine />
        </div>
      )}
      {status.error && (
        <p role="alert" className="type-small text-danger-text">
          {status.error}
        </p>
      )}
    </div>
  );
}
