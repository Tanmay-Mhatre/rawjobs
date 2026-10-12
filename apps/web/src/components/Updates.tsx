import { Copy, ExternalLink, Info, LoaderCircle, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, timeAgo } from "../lib/format";
import {
  announceUpdateStatus,
  checkForUpdate,
  clearUpdatingTo,
  installLine,
  ISSUES_URL,
  markUpdateSeen,
  RELEASES_URL,
  saveUpdateSettings,
  updateNow,
  updatingTo,
  useServerHealth,
  useUpdateStatus,
  type UpdateStatus,
} from "../lib/update";
import { DesktopShortcutNotice, Row } from "./DesktopShortcut";
import { RequiredUpdate } from "./RequiredUpdate";
import { toast } from "./Toast";
import { Button, Card, Toggle } from "./ui";
import { Anchor, ChangeRows, Head, Points, sortedItems, VersionLine } from "./UpdateParts";
import { WhatsNewDialog } from "./WhatsNew";
import { Dialog } from "./Dialog";

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
  // Back as the new version, or back on the old one: the update this page started is over.
  useEffect(() => {
    const u = updatingTo();
    if (u && status && (status.current === u.to || status.lastUpdate)) clearUpdatingTo();
  }, [status]);
  // While it waits for a scan or restarts, follow along.
  useEffect(() => {
    if (status?.state !== "waiting" && status?.state !== "updating") return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [status?.state, refresh]);

  // An update this page started: "Updating to 0.6.1" from the click until the page reloads as it.
  const started = updatingTo();
  // (A required update shows its own Updating state until the server goes away.)
  if (started && (down || (status?.state === "updating" && !status.available?.critical))) return <UpdatingCover from={started.from} to={started.to} />;
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
    <section role="status" aria-labelledby="went-back-title" className="mb-3 flex items-start gap-4 rounded-md border border-line bg-raised p-4">
      <Anchor kind="warn" />
      <div className="min-w-0 flex-1">
        <h2 id="went-back-title" className="type-subheading font-semibold text-balance">
          The update to {last.to} didn't start
        </h2>
        <p className="mt-1 flex items-center gap-1.5 type-small text-muted">
          <Undo2 className="size-3.5" aria-hidden /> Went back to {last.from}
        </p>
        <Points
          className="mt-3"
          items={[
            [ShieldCheck, "Nothing changed. Your data is as it was."],
            [Info, `RawJobs won't offer ${last.to} again. The next version comes up by itself.`],
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void seen()}>
            Got it
          </Button>
          <a className={linkClass} href={ISSUES_URL} target="_blank" rel="noreferrer">
            Report a problem <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * From the click on Update until the page reloads as the new version: a small card over the
 * page (nothing to click on a server that's restarting). If it takes longer than half a minute,
 * it says so and offers to reload.
 */
function UpdatingCover({ from, to }: { from: string; to: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 30_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <Dialog open persistent onClose={() => {}} labelledBy="updating-title" describedBy="updating-desc" className="max-w-[26rem]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <Head id="updating-title" anchor={<Anchor kind="mark" busy />} title={`Updating to ${to}`} from={from} to={to} label="Restarting" />
        <p id="updating-desc" role="status" className="mt-4 type-body">
          {slow ? "Taking longer than usual. RawJobs is still restarting." : "Back in a few seconds. The page reloads by itself."}
        </p>
        <Points items={[[ShieldCheck, "Your data is backed up first"]]} />
        {slow && (
          <div className="mt-5 flex justify-end">
            <Button variant="primary" data-autofocus onClick={() => location.reload()}>
              <RefreshCw className="size-4" aria-hidden /> Reload page
            </Button>
          </div>
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
        <Row label="Latest version">{a && !status.tooOld ? <LatestVersion status={status} busy={busy === "update"} onUpdate={() => void run("update")} /> : latest}</Row>
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

/** Settings → About → Latest version: what's waiting, its top changes, and the button that installs it. */
function LatestVersion({ status, busy, onUpdate }: { status: UpdateStatus; busy: boolean; onUpdate: () => void }) {
  const a = status.available!;
  const top = sortedItems(a.notes, a.changes).slice(0, 2);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rj-dot" aria-hidden />
        <VersionLine from={status.current} to={a.version} label={a.critical ? "Required update" : "Ready to install"} />
      </div>
      {top.length > 0 && <ChangeRows items={top} />}
      <div className="flex flex-wrap items-center gap-2">
        <UpdateButton status={status} onClick={onUpdate} busy={busy} label={`Update to ${a.version}`} />
        <a href="#settings?section=release-notes" className="type-small text-muted underline underline-offset-2 hover:text-ink">
          See all changes
        </a>
      </div>
    </div>
  );
}
