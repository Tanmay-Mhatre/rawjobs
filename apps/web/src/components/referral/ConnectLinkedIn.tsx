import { canInflateRaw } from "@rawjobs/core/network/zip-browser";
import { ExternalLink, Upload, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { LINK_REL } from "../../lib/contactLinks";
import {
  cancelReminder,
  IMPORT_ERROR,
  type ImportErrorCode,
  importNetworkFile,
  type NetworkStatus,
  setReminder,
  startWatch,
  stopWatch,
  UNZIP_FIRST,
  useNetwork,
  type WatchState,
} from "../../lib/network";
import { Dialog } from "../Dialog";
import { Button, Card, cx, IconButton } from "../ui";

/** LinkedIn's "Get a copy of your data" page. */
export const LINKEDIN_DATA_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

type Step = { kind: "idle" } | { kind: "reading"; name: string } | { kind: "done"; status: Extract<NetworkStatus, { connected: true }> } | { kind: "error"; text: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "14:30" today, "Wed 14:30" on another day. */
export function watchUntil(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** "Fri 23 Oct, 09:00": the weekday, date and time a reminder comes, in local time. */
export function remindWhen(iso: string): string {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString([], o);
  return `${part({ weekday: "short" })} ${part({ day: "numeric" })} ${part({ month: "short" })}, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** Under step 2, once LinkedIn's page was opened: "Remind me in 48 hours if I haven't added the file". */
function RemindMe({ at }: { at: string | null }) {
  const [failed, setFailed] = useState(false);
  const toggle = async (on: boolean) => {
    setFailed(false);
    if (on) setFailed(!(await setReminder()));
    else await cancelReminder();
  };
  return (
    <div className="mt-2">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={!!at} onChange={(e) => void toggle(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink" />
        <span>Remind me in 48 hours if I haven't added the file</span>
      </label>
      {at && (
        <p className="mt-1 pl-6.5 text-muted">
          We'll remind you {remindWhen(at)}.{" "}
          <button type="button" className="font-medium underline underline-offset-2 hover:text-ink" onClick={() => void toggle(false)}>
            Cancel
          </button>
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-1 pl-6.5 text-danger-text">
          Couldn't set the reminder. Check that RawJobs is running, then try again.
        </p>
      )}
    </div>
  );
}

/** "Watching Downloads until 14:30. Stop", for the panel and Settings while a watch runs. */
export function WatchLine({ watch, className }: { watch: WatchState; className?: string }) {
  return (
    <p className={cx("type-small text-muted", className)}>
      Watching Downloads until {watchUntil(watch.until)}.{" "}
      <button type="button" className="font-medium underline underline-offset-2 hover:text-ink" onClick={() => void stopWatch()}>
        Stop
      </button>
    </p>
  );
}

/**
 * The guided import: get LinkedIn's export, then pick or drop it here. The browser reads the ZIP and
 * sends only Connections, Positions and Education to RawJobs on this computer.
 */
export function ConnectLinkedIn({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Checked once: browsers without "deflate-raw" can still import Connections.csv on its own.
  const [zipOk] = useState(canInflateRaw);
  const busy = step.kind === "reading";
  const network = useNetwork();
  const status = network?.state === "ready" ? network.value.status : null;
  const watchable = network?.state === "ready" && !!network.value.watchable;
  const watch = status?.watch ?? null;
  const reminder = network?.state === "ready" ? (network.value.reminder ?? null) : null;
  // A reminder still to come; one that's due is over (ticking the box again sets a new one).
  const remindAt = reminder && !reminder.due ? reminder.at : null;
  const [opened, setOpened] = useState(false);
  const [pickUp, setPickUp] = useState(true);
  const [watchError, setWatchError] = useState<string | null>(null);
  // While the dialog waits on a watch: the import it started from, so a new one shows as done here.
  const [waitFrom, setWaitFrom] = useState<string | null | undefined>(undefined);
  const importedAt = status?.connected ? status.importedAt : null;
  const waiting = open && !!watch;
  useEffect(() => {
    if (waiting) setWaitFrom((w) => (w === undefined ? importedAt : w));
  }, [waiting, importedAt]);
  useEffect(() => {
    if (waitFrom === undefined || !status?.connected || status.importedAt === waitFrom) return;
    setWaitFrom(undefined);
    setStep({ kind: "done", status });
  }, [waitFrom, status]);

  const close = () => {
    if (busy) return;
    setStep({ kind: "idle" });
    setWatchError(null);
    setWaitFrom(undefined);
    setOpened(false);
    onClose();
  };
  /** Step 1 with the box ticked: start watching Downloads as LinkedIn's page opens. */
  const onOpenLinkedIn = async () => {
    setOpened(true);
    if (!watchable || !pickUp || watch) return;
    setWatchError(null);
    setWatchError(await startWatch());
  };
  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setStep({ kind: "reading", name: file.name });
    const r = await importNetworkFile(file);
    if (fileRef.current) fileRef.current.value = "";
    if (r.ok && r.status.connected) setStep({ kind: "done", status: r.status });
    else setStep({ kind: "error", text: IMPORT_ERROR[r.ok ? "FAILED" : r.code] });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void onFile(e.dataTransfer.files[0]);
  };
  // Escape closes this dialog only, not the job behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") e.stopPropagation();
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="connect-linkedin-title" initialFocus="[data-autofocus]">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops Escape from reaching the page's own shortcut */}
      <div onKeyDown={onKeyDown}>
        <Card className="p-5 shadow-l3 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id="connect-linkedin-title" className="min-w-0 flex-1 type-subheading font-semibold">
              Connect LinkedIn
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={close} disabled={busy}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 type-small text-muted">RawJobs reads LinkedIn's own copy of your connections. No LinkedIn login, and your connections stay on this computer.</p>

          {step.kind === "done" ? (
            <div role="status" className="mt-4 space-y-2 type-small">
              <p className="font-medium text-success-text">
                Imported {plural(step.status.counts.connections, "connection")}, {plural(step.status.counts.positions, "position")} and {plural(step.status.counts.education, "school")}.
              </p>
              <p className="text-muted">You can delete the ZIP from Downloads now. RawJobs keeps only names, companies, positions and the date you connected.</p>
            </div>
          ) : (
            <ol className="mt-4 list-decimal space-y-3 pl-5 type-small">
              <li>
                <a
                  href={LINKEDIN_DATA_URL}
                  target="_blank"
                  rel={LINK_REL}
                  className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2 hover:text-muted"
                  data-autofocus
                  onClick={() => void onOpenLinkedIn()}
                >
                  Open LinkedIn's data page <ExternalLink className="size-3.5" aria-hidden />
                </a>
                {watchable && !watch && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={pickUp} onChange={(e) => setPickUp(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink" />
                    <span>
                      Pick up the file from my Downloads folder by itself
                      <span className="block text-muted">RawJobs looks only for LinkedIn's file name, for the next 48 hours.</span>
                    </span>
                  </label>
                )}
              </li>
              <li>
                Choose <b>Download larger data archive</b>, then Request archive. Only the larger archive has your connections.
                {(opened || remindAt) && <RemindMe at={remindAt} />}
              </li>
              <li>LinkedIn emails you when the file is ready, usually within a day. Download it.</li>
              <li>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target; the button inside is the keyboard way in */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={onDrop}
                  className={cx("mt-1 flex flex-col items-start gap-2 rounded-md border border-dashed p-4", over ? "border-ink bg-sunken" : "border-line")}
                >
                  {watch && (
                    <p role="status" className="font-medium text-ink">
                      Watching Downloads for Basic_LinkedInDataExport_….zip
                    </p>
                  )}
                  <p className="text-muted">{zipOk ? "Drop the ZIP here, or choose the file." : `${UNZIP_FIRST}.`}</p>
                  <Button onClick={() => fileRef.current?.click()} disabled={busy}>
                    <Upload className="size-4" /> {zipOk ? "Choose the ZIP file" : "Choose Connections.csv"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={zipOk ? ".zip,application/zip,.csv,text/csv" : ".csv,text/csv"}
                    className="hidden"
                    aria-label={zipOk ? "LinkedIn export ZIP" : "Connections.csv"}
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                </div>
              </li>
            </ol>
          )}

          {step.kind === "reading" && (
            <p role="status" className="mt-3 type-small text-muted">
              Reading {step.name}…
            </p>
          )}
          {step.kind !== "done" && (watchError || (watch?.lastError && watch.lastError in IMPORT_ERROR)) && (
            <p role="alert" className="mt-3 type-small text-danger-text">
              {watchError ?? IMPORT_ERROR[watch?.lastError as ImportErrorCode]}
            </p>
          )}
          {step.kind === "error" && (
            <p role="alert" className="mt-3 type-small text-danger-text">
              {step.text}
            </p>
          )}

          <div className="mt-5 flex justify-end">
            <Button variant={step.kind === "done" ? "primary" : "ghost"} onClick={close} disabled={busy}>
              {step.kind === "done" ? "Done" : "Close"}
            </Button>
          </div>
        </Card>
      </div>
    </Dialog>
  );
}
