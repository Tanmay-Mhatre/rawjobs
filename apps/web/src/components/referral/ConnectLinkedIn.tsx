import { canInflateRaw } from "@rawjobs/core/network/zip-browser";
import { ExternalLink, Upload, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useRef, useState } from "react";
import { LINK_REL } from "../../lib/contactLinks";
import { IMPORT_ERROR, importNetworkFile, type NetworkStatus, UNZIP_FIRST } from "../../lib/network";
import { Dialog } from "../Dialog";
import { Button, Card, cx, IconButton } from "../ui";

/** LinkedIn's "Get a copy of your data" page. */
export const LINKEDIN_DATA_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

type Step = { kind: "idle" } | { kind: "reading"; name: string } | { kind: "done"; status: Extract<NetworkStatus, { connected: true }> } | { kind: "error"; text: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

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

  const close = () => {
    if (busy) return;
    setStep({ kind: "idle" });
    onClose();
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
                <a href={LINKEDIN_DATA_URL} target="_blank" rel={LINK_REL} className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2 hover:text-muted" data-autofocus>
                  Open LinkedIn's data page <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </li>
              <li>
                Choose <b>Want something in particular?</b> and tick Connections, Positions and Education. Then Request archive.
              </li>
              <li>LinkedIn emails you when the file is ready, usually in about 10 minutes. Download it.</li>
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
