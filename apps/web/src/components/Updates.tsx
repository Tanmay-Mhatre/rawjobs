import { CircleAlert, CloudDownload, Copy, ExternalLink, LoaderCircle, Monitor, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, timeAgo } from "../lib/format";
import { load, save } from "../lib/storage";
import {
  addDesktopShortcut,
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
import { Dialog } from "./Dialog";
import { toast } from "./Toast";
import { Button, Card, cx, Toggle } from "./ui";

/** Release notes, as plain lines (they come from the release's tag message). */
function Notes({ text, open = false }: { text: string; open?: boolean }) {
  if (!text.trim()) return null;
  return (
    <details className="mt-1 type-small" open={open}>
      <summary className="cursor-pointer text-muted">What's new</summary>
      <div className="mt-1 max-h-60 space-y-1 overflow-y-auto whitespace-pre-wrap text-ink">{text.trim()}</div>
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

const DISMISSED_KEY = "rawjobs.update.dismissed";

/**
 * Above the page, on an installed copy: "RawJobs is restarting" while the server is away (the page
 * reloads by itself when it's back as a new version), then how the last update went, or a new
 * version (a quiet note you can dismiss). A required update, or a version too old to update by
 * itself, comes up in a window instead (RequiredUpdate).
 */
export function ServerNotices() {
  const { down } = useServerHealth();
  const { status, setStatus, refresh } = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => load<string | null>(DISMISSED_KEY, null));
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
  };
  const required = !!status.available?.critical || status.tooOld;
  const dialog = required ? <RequiredUpdate status={status} update={update} busy={busy} /> : null;

  const last = status.lastUpdate;
  if (last) {
    const seen = async () => {
      const s = await markUpdateSeen();
      if (s) setStatus(s);
    };
    return (
      <>
        {dialog}
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
                <b>
                  The update to {last.to} didn't work, so you're still on {last.from}.
                </b>{" "}
                Nothing of yours changed. RawJobs won't offer that version again.
              </p>
            )}
          </div>
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
      </>
    );
  }

  const a = status.available;
  if (required || !a || dismissed === a.version) return dialog;
  const dismiss = () => {
    save(DISMISSED_KEY, a.version);
    setDismissed(a.version);
  };
  return (
    <div role="status" className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md bg-inset/60 px-3 py-2 type-small">
      <CloudDownload className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          <b>RawJobs {a.version} is ready.</b>{" "}
          <span className="text-muted">
            {status.state === "waiting" ? "It installs as soon as the scan that's running is done." : "Install it when it suits you: it takes a few seconds, and your data stays."}
          </span>
        </p>
        <Notes text={a.notes} />
        {status.error && <p className="mt-1 text-danger-text">{status.error}</p>}
      </div>
      <div className="flex items-center gap-1">
        <UpdateButton status={status} onClick={() => void update()} busy={busy} label="Update now" />
        {status.state === "idle" && (
          <button
            type="button"
            aria-label="Not now"
            title="Not now (it's in Settings → About too)"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
            onClick={dismiss}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A required update: a window that closes only by updating. If the update itself fails (offline, a
 * download that broke), you can go on for now; it asks again the next time the dashboard opens.
 * A version too old to update by itself asks for the install line instead.
 */
function RequiredUpdate({ status, update, busy }: { status: UpdateStatus; update: () => Promise<void>; busy: boolean }) {
  const [later, setLater] = useState(false);
  const a = status.available;
  const failed = !!status.error && status.state === "idle";
  if (later) return null;
  return (
    <Dialog open persistent onClose={() => {}} labelledBy="required-update-title">
      <Card className="space-y-3 p-5 shadow-l3 sm:p-6">
        <h2 id="required-update-title" className="type-subheading font-semibold">
          {status.tooOld ? "Reinstall RawJobs to keep using it" : `Update to RawJobs ${a?.version}`}
        </h2>
        {status.tooOld ? (
          <>
            <p className="type-small">
              This version (<b>{status.current}</b>) is too old to update by itself. Run the install line again: it installs the newest RawJobs and keeps your profile, tracking and scan data.
            </p>
            <CopyInstallLine />
          </>
        ) : (
          <>
            <p className="type-small">
              This is a required update. It takes a few seconds; your profile, tracking and scan data stay as they are, and are backed up first.
              {status.state === "waiting" && " A scan is running: RawJobs updates as soon as it's done."}
            </p>
            {a && <Notes text={a.notes} open />}
            {failed && (
              <p role="alert" className="type-small text-danger-text">
                {status.error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {failed && (
                <Button variant="ghost" onClick={() => setLater(true)}>
                  Continue for now
                </Button>
              )}
              <UpdateButton status={status} onClick={() => void update()} busy={busy} label={failed ? "Try again" : "Update now"} />
            </div>
          </>
        )}
      </Card>
    </Dialog>
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
        Check for new versions every day
      </Toggle>
      <p className="type-small text-muted">
        A new version is downloaded in the background and checked against RawJobs' signing key, but it only installs when you click Update. A required fix asks until you update.
      </p>
      <Toggle checked={status.settings.channel === "beta"} onChange={(on) => void saveUpdateSettings({ channel: on ? "beta" : "stable" }).then(apply)}>
        Get test versions early (beta: newer, and more likely to have problems)
      </Toggle>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="type-small text-muted">{label}</dt>
      <dd className="min-w-0 type-small text-ink">{children}</dd>
    </div>
  );
}

const linkClass = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 type-small text-muted hover:bg-inset hover:text-ink";

/** Settings → About: which version this is, since when, what's newer, and where everything is. */
export function AboutRawJobs() {
  const { status, setStatus } = useUpdateStatus();
  const [busy, setBusy] = useState<"check" | "update" | "shortcut" | null>(null);

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

  const run = async (kind: "check" | "update" | "shortcut") => {
    setBusy(kind);
    const s = kind === "check" ? await checkForUpdate() : kind === "update" ? await updateNow() : await addDesktopShortcut();
    if (s) setStatus(s);
    announceUpdateStatus();
    if (kind === "shortcut" && s?.about?.desktopShortcut) toast({ message: "Added RawJobs to your Desktop" });
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
          {a && <Notes text={a.notes} />}
        </Row>
        <Row label="Last checked">
          {status.settings.mode === "off" ? "Checking is off (Updates, below)." : status.lastCheck ? `${timeAgo(status.lastCheck)}, ${formatDate(status.lastCheck)}` : "Not yet"}
        </Row>
        <Row label="Dashboard">
          <code className="font-mono">{location.origin}</code> <span className="text-muted">(the RawJobs shortcut always opens the right address)</span>
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
        {about && !about.desktopShortcut && (
          <Button onClick={() => void run("shortcut")} disabled={!!busy}>
            {busy === "shortcut" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Monitor className="size-3.5" />} Add a Desktop shortcut
          </Button>
        )}
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
