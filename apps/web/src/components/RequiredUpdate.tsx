import { type ReleaseChange, releaseItems } from "@rawjobs/core/release-notes";
import { ArrowRight, Check, ChevronDown, CirclePause, Clock, Copy, Download, Info, LoaderCircle, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import mark from "../design/logos/rawjobs-mark.svg";
import { INSTALL_LINE, type UpdateStatus } from "../lib/update";
import { Dialog } from "./Dialog";
import { toast } from "./Toast";
import { Button, Card, cx } from "./ui";
import { ChangeTag } from "./WhatsNew";

/**
 * A required update (a release tagged "Update: mandatory"): a window that closes only by updating,
 * readable at a glance. The app icon and "0.5.3 → 0.6.0" say what it is, one sentence says why,
 * three short points answer "how long, my data, my scan", then the top changes and one button.
 *
 * Its states (design: the approved mockup, 2026-10-12):
 *   ready      Update now
 *   updating   the icon with a spinner; the page reloads by itself
 *   failed     what happened and what to do: Try again, or Continue for now (asks again next time)
 *   too old    this version can't update itself: two steps, with the install line to copy
 * Clicking Update while a scan runs doesn't keep you here: the window closes, a toast confirms, the
 * header's Update pill waits with a spinner, and RawJobs updates when the scan is done.
 */
export function RequiredUpdate({ status, update, busy }: { status: UpdateStatus; update: () => Promise<UpdateStatus | null>; busy: boolean }) {
  const [later, setLater] = useState(false);
  // Errors from the background checks aren't this window's business: only after you clicked.
  const [tried, setTried] = useState(false);
  const a = status.available;
  // You said yes during a scan: nothing more to ask (the header pill shows it waiting).
  if (later || status.state === "waiting") return null;

  const from = status.current;
  const to = a?.version ?? "";
  const updating = busy || status.state === "updating";
  const failed = tried && !!status.error && status.state === "idle";
  const go = async () => {
    setTried(true);
    const s = await update();
    if (s?.state === "waiting") toast({ message: "RawJobs updates when the scan finishes. Keep working." });
  };

  let body: ReactNode;
  if (status.tooOld) body = <TooOld from={from} />;
  else if (failed)
    body = (
      <>
        <Head anchor={<Anchor kind="alert" />} title="The update didn't finish" from={from} to={to} label="Not installed" />
        <p id="required-update-desc" role="alert" className="mt-4 type-body">
          {status.error}
        </p>
        <Points
          items={[
            [ShieldCheck, `Nothing changed. You're still on ${from} and your data is as it was.`],
            [Info, "Continue for now and RawJobs asks again the next time you open it."],
          ]}
        />
        {!/^Couldn't reach GitHub/.test(status.error ?? "") && (
          <button
            type="button"
            className="mt-2 type-small text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => void navigator.clipboard?.writeText(`RawJobs ${from} → ${to}: ${status.error}`).then(() => toast({ message: "Copied the error details" }))}
          >
            Copy error details
          </button>
        )}
        <Foot>
          <Button variant="ghost" onClick={() => setLater(true)}>
            Continue for now
          </Button>
          <Button variant="primary" data-autofocus onClick={() => void go()} className="max-sm:h-11 max-sm:w-full">
            <RefreshCw className="size-4" aria-hidden /> Try again
          </Button>
        </Foot>
      </>
    );
  else if (updating)
    body = (
      <>
        <Head anchor={<Anchor kind="mark" busy />} title={`Updating to ${to}`} from={from} to={to} label="Required" />
        <p id="required-update-desc" role="status" className="mt-4 type-body">
          Restarting RawJobs… The page reloads by itself.
        </p>
        <Points
          items={[
            [ShieldCheck, "Your data is backed up first"],
            [Clock, "Usually a few seconds"],
          ]}
        />
        <Foot>
          <Button variant="primary" disabled aria-busy className="max-sm:h-11 max-sm:w-full">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Updating…
          </Button>
        </Foot>
      </>
    );
  else
    body = (
      <>
        <Head anchor={<Anchor kind="mark" />} title={`Update to RawJobs ${to}`} from={from} to={to} label="Required" />
        <p id="required-update-desc" className="mt-4 type-body">
          This update is required to keep using RawJobs.
        </p>
        <Points
          items={[
            [Clock, "Takes a few seconds"],
            [ShieldCheck, "Your data stays, backed up first"],
            [CirclePause, "Updates after a running scan"],
          ]}
        />
        {a && <Changes to={to} notes={a.notes} changes={a.changes} />}
        <Foot>
          <Button variant="primary" data-autofocus onClick={() => void go()} className="max-sm:h-11 max-sm:w-full">
            <Download className="size-4" aria-hidden /> Update now
          </Button>
        </Foot>
      </>
    );

  return (
    <Dialog open persistent onClose={() => {}} labelledBy="required-update-title" describedBy="required-update-desc" initialFocus="[data-autofocus]" className="max-w-[30rem]">
      <Card className="p-5 shadow-l3 sm:p-6">{body}</Card>
    </Dialog>
  );
}

/** The icon slot: the app icon (with a spinner while updating), an alert, or a terminal. */
function Anchor({ kind, busy = false }: { kind: "mark" | "alert" | "terminal"; busy?: boolean }) {
  if (kind === "mark")
    return (
      <span className="relative size-10 shrink-0 sm:size-12">
        {/* The border keeps the icon's dark square visible on a dark card. */}
        <img src={mark} alt="" className="size-full rounded-md border border-control" />
        {busy && (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-md border border-control bg-raised text-ink">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          </span>
        )}
      </span>
    );
  return (
    <span
      className={cx(
        "grid size-10 shrink-0 place-items-center rounded-md border sm:size-12",
        kind === "alert" ? "border-danger-text bg-danger-subtle text-danger-text" : "border-control bg-inset text-ink",
      )}
    >
      {kind === "alert" ? <TriangleAlert className="size-6" aria-hidden /> : <Terminal className="size-6" aria-hidden />}
    </span>
  );
}

/** The icon, the title, and "0.5.3 → 0.6.0 · Required". */
function Head({ anchor, title, from, to, label }: { anchor: ReactNode; title: string; from: string; to: string; label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden>{anchor}</span>
      <div className="min-w-0">
        <h2 id="required-update-title" className="type-heading text-balance">
          {title}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-small text-muted tabular-nums">
          <span>{from}</span>
          {to && (
            <>
              <ArrowRight className="size-3.5" aria-label="to" />
              <span className="font-medium text-ink">{to}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{label}</span>
        </p>
      </div>
    </div>
  );
}

type Icon = typeof Clock;
function Points({ items }: { items: [Icon, string][] }) {
  return (
    <ul className="mt-4 grid gap-2">
      {items.map(([I, text]) => (
        <li key={text} className="flex items-start gap-2 type-small text-ink">
          <I className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

const ORDER: Record<ReleaseChange["type"], number> = { new: 0, improved: 1, fixed: 2 };

/** "What's new in 0.6.0": the top three changes, New first, and "See all n changes". */
function Changes({ to, notes, changes }: { to: string; notes: string; changes?: ReleaseChange[] }) {
  const items = releaseItems(notes, changes)
    .map((c, i) => ({ ...c, i }))
    .sort((x, y) => (x.type && y.type ? ORDER[x.type] - ORDER[y.type] : 0) || x.i - y.i);
  if (!items.length) return null;
  const list = (xs: typeof items) => (
    <ul className="grid gap-2">
      {xs.map((c) => (
        <li key={c.i} className={cx("grid items-start gap-2 type-small text-ink", c.type ? "grid-cols-[4.75rem_minmax(0,1fr)]" : "grid-cols-[0.75rem_minmax(0,1fr)]")}>
          {c.type ? (
            <ChangeTag type={c.type} />
          ) : (
            <span aria-hidden className="text-muted">
              •
            </span>
          )}
          <span className="pt-px">{c.text}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby="required-update-new" className="mt-6 border-t border-hairline pt-4">
      <h3 id="required-update-new" className="mb-3 type-label text-muted">
        What's new in {to}
      </h3>
      {list(items.slice(0, 3))}
      {items.length > 3 && (
        <details className="group mt-2">
          <summary className="-ml-2 inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 type-label text-muted hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">See all {items.length} changes</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="mt-2">{list(items.slice(3))}</div>
        </details>
      )}
    </section>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

/** Too old to update by itself: copy the install line, paste it, done (your data stays). */
function TooOld({ from }: { from: string }) {
  const [unix, setUnix] = useState(!/Windows/i.test(navigator.userAgent));
  const [copied, setCopied] = useState(false);
  const line = unix ? INSTALL_LINE.unix : INSTALL_LINE.windows;
  // Opening the window puts the cursor at the field's end for a moment: show the line from its start.
  const field = useRef<HTMLInputElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the line changes (Windows / Mac or Linux), to show the new one from its start
  useEffect(() => {
    const t = setTimeout(() => field.current?.scrollTo({ left: 0 }), 50);
    return () => clearTimeout(t);
  }, [line]);
  const copy = () =>
    void navigator.clipboard?.writeText(line).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <>
      <Head anchor={<Anchor kind="terminal" />} title="Reinstall RawJobs to keep using it" from={from} to="" label="Reinstall needed" />
      <p id="required-update-desc" className="mt-4 type-body">
        {from} is too old to update by itself. Reinstalling gets the newest version and keeps your data.
      </p>
      <ol className="mt-4 grid gap-4">
        <Step n={1} title="Copy the install line">
          <div className="mt-2 flex items-stretch gap-2">
            <input
              ref={field}
              readOnly
              value={line}
              aria-label="Install line"
              onClick={(e) => e.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-md border border-control bg-inset px-3 font-mono type-meta text-ink"
            />
            <Button variant="primary" data-autofocus onClick={copy}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Step>
        <Step n={2} title={`Paste it in ${unix ? "Terminal" : "PowerShell"} and press Enter`}>
          <p className="mt-1 type-small text-muted">
            Your profile, tracking and scan data stay.{" "}
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setUnix((u) => !u)}>
              {unix ? "On Windows?" : "On a Mac or Linux?"}
            </button>
          </p>
        </Step>
      </ol>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
      <span aria-hidden className="grid size-6 place-items-center rounded-md border border-control type-label tabular-nums">
        {n}
      </span>
      <div>
        <p className="mt-0.5 type-label text-ink">
          <span className="sr-only">Step {n}: </span>
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}
