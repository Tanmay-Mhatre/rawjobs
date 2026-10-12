import { Check, CircleAlert, Copy, LoaderCircle, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import mark from "../design/logos/rawjobs-mark.svg";
import { addDesktopShortcut, announceUpdateStatus, markShortcutNoticeSeen, type UpdateStatus } from "../lib/update";
import { Dialog } from "./Dialog";
import { toast } from "./Toast";
import { Button, Card } from "./ui";

/**
 * The RawJobs shortcuts (packages/server/src/shortcuts.ts): one on the Desktop, one in the Start menu
 * / Applications / app menu. They open the dashboard on whatever port it's on, so people don't have
 * to remember an address (typing 127.0.0.1 without :4317 is how they get "This site can't be reached").
 */

/** A label and its value, in Settings → About's lists. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="type-small text-muted">{label}</dt>
      <dd className="min-w-0 type-small text-ink">{children}</dd>
    </div>
  );
}

type Shortcuts = NonNullable<NonNullable<UpdateStatus["about"]>["shortcuts"]>;

/** Where this computer keeps apps, as its own UI names it. */
function place(platform: string | undefined): { name: string; in: string } {
  if (platform?.startsWith("win32")) return { name: "Start menu", in: "in the Start menu" };
  if (platform?.startsWith("darwin")) return { name: "Applications", in: "in Applications" };
  return { name: "App menu", in: "in your app menu" };
}

const SETTINGS_LINK = "#settings?section=shortcut";

/**
 * Once per computer, the first time you land on the Radar after the shortcuts were made: what's on
 * your Desktop and why to use it. Only about shortcuts that really exist. Closing it, or following
 * its link to Settings, counts as seen.
 */
export function DesktopShortcutNotice({ status, onSeen }: { status: UpdateStatus; onSeen: (s: UpdateStatus | null) => void }) {
  const [open, setOpen] = useState(true);
  const about = status.about;
  const s = about?.shortcuts;
  if (!open || !about || !s) return null;
  const where = place(about.platform);
  const updated = about.since?.by === "update";
  const seen = () => {
    setOpen(false);
    void markShortcutNoticeSeen().then(onSeen);
  };
  const title = s.desktop ? (updated ? "New: RawJobs is on your Desktop" : "RawJobs is on your Desktop") : `Open RawJobs from the ${where.name === "App menu" ? "app menu" : where.name}`;

  return (
    // Focus starts on the button: Enter closes it, rather than following the link to Settings.
    <Dialog open onClose={seen} labelledBy="shortcut-notice-title" describedBy="shortcut-notice-body" initialFocus="[data-autofocus]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-4">
          {/* What to look for on the Desktop: the real icon (as it is, both themes) and its name. The
              border-control frame keeps its dark square visible on a dark card (3:1). */}
          <figure aria-hidden className="flex w-14 shrink-0 flex-col items-center gap-2 sm:w-16">
            <img src={mark} alt="" className="size-10 rounded-md border border-control sm:size-12" />
            <figcaption className="type-meta text-ink">RawJobs</figcaption>
          </figure>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id="shortcut-notice-title" className="type-subheading font-semibold text-balance">
              {title}
            </h2>
            <p id="shortcut-notice-body" className="type-small text-ink">
              It opens RawJobs at the right address, and starts it if it's stopped. No address to remember.
              {s.desktop && s.menu && ` It's also ${where.in}.`}
            </p>
            <p className="type-small text-muted">
              {s.desktop ? "Deleted it? " : "Want it on your Desktop too? "}
              <a href={SETTINGS_LINK} onClick={seen} className="font-medium text-ink underline underline-offset-2 hover:text-muted">
                {s.desktop ? "Add it back in Settings." : "Add it in Settings."}
              </a>
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="primary" data-autofocus onClick={seen}>
            Got it
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}

function State({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={ok ? "inline-flex items-center gap-1.5" : "inline-flex items-center gap-1.5 text-warning-text"}>
      {ok ? <Check className="size-4 shrink-0" aria-hidden /> : <CircleAlert className="size-4 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** Settings → About → Desktop shortcut: where the shortcuts are, the address, and adding them (again). */
export function DesktopShortcutSettings({ status, setStatus }: { status: UpdateStatus; setStatus: (s: UpdateStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const s: Shortcuts | null | undefined = status.about?.shortcuts;
  if (!status.installed || !s) return null;
  const where = place(status.about?.platform);
  const missing = s.desktopFolder && !s.desktop;

  const make = async () => {
    setBusy(true);
    const next = await addDesktopShortcut();
    setBusy(false);
    if (!next) return;
    setStatus(next);
    announceUpdateStatus();
    const now = next.about?.shortcuts;
    if (now?.desktop && !s.desktop) toast({ message: "Added RawJobs to your Desktop" });
    else if (now?.desktop || (!now?.desktopFolder && now?.menu)) toast({ message: "Shortcut added" });
  };
  const copy = () => void navigator.clipboard?.writeText(location.origin).then(() => toast({ message: "Copied the address" }));

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line">
        {s.desktopFolder && (
          <Row label="Desktop">
            <State ok={s.desktop}>{s.desktop ? "On your Desktop" : "Not on your Desktop"}</State>
          </Row>
        )}
        <Row label={where.name}>
          <State ok={s.menu}>{s.menu ? `In ${where.in.replace(/^in /, "")}` : `Not ${where.in}`}</State>
          {!s.desktopFolder && <span className="block text-muted">This computer has no Desktop folder, so RawJobs is {where.in}.</span>}
        </Row>
        <Row label="Address">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="break-all font-mono">{location.origin}</code>
            <Button size="sm" variant="ghost" onClick={copy}>
              <Copy className="size-3.5" /> Copy address
            </Button>
          </span>
          <span className="block text-muted">To type it yourself, include the {location.port ? `:${location.port}` : "port"}. The shortcut finds it for you.</span>
        </Row>
      </dl>
      {missing && s.desktopError && (
        <p role="alert" className="type-small text-danger-text">
          Couldn't add the shortcut: {s.desktopError}. Try again, or use the RawJobs shortcut {where.in}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {missing ? (
          <Button variant="primary" onClick={() => void make()} disabled={busy} aria-busy={busy}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {busy ? "Adding…" : s.desktopError ? "Try again" : "Add to Desktop"}
          </Button>
        ) : (
          <Button onClick={() => void make()} disabled={busy} aria-busy={busy}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} {busy ? "Adding…" : "Add shortcut"}
          </Button>
        )}
        {!missing && <span className="type-small text-muted">Adds it again if the icon looks wrong or the shortcut doesn't open RawJobs.</span>}
      </div>
    </div>
  );
}
