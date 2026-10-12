import type { ChangelogEntry, ReleaseChange } from "@rawjobs/core/release-notes";
import { releaseItems } from "@rawjobs/core/release-notes";
import { ArrowDownToLine, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDate } from "../lib/format";
import { announceUpdateStatus, loadChangelog, markUpdateSeen, updateNow, useUpdateStatus, type Changelog, type UpdateStatus } from "../lib/update";
import { Dialog } from "./Dialog";
import { Button, Card, cx, Segmented } from "./ui";

/**
 * What changed, version by version: the tag on each line (New, Improved, Fixed), a release's list,
 * the "What's new" window after an update, and Settings → About → Release notes. The notes come from
 * each release's tag message (packages/core/src/release-notes.ts); the bundle carries every version's
 * (changelog.json), so a copy knows what changed in every version up to its own.
 */

// Orange is kept for the primary button, the star and the new dot (design/README.md, One accent):
// the tags are a word on a quiet tint, told apart by the word first.
const TAG: Record<ReleaseChange["type"], { label: string; className: string }> = {
  new: { label: "New", className: "bg-success-subtle text-success-text" },
  improved: { label: "Improved", className: "bg-inset text-ink" },
  fixed: { label: "Fixed", className: "border border-line text-muted" },
};

/** A change's kind, as a word on a tint (never color alone). */
export function ChangeTag({ type }: { type: ReleaseChange["type"] }) {
  const t = TAG[type];
  return <span className={cx("inline-flex h-5 shrink-0 items-center justify-self-start rounded-sm px-1.5 type-meta font-medium", t.className)}>{t.label}</span>;
}

/** One release's changes: a tag and a sentence each (a release from before tags: its lines, untagged). */
export function ReleaseList({ notes, changes, filter }: { notes: string; changes?: ReleaseChange[]; filter?: ReleaseChange["type"] | "all" }) {
  const items = releaseItems(notes, changes).filter((i) => !filter || filter === "all" || i.type === filter);
  if (!items.length) return null;
  // A tag column as wide as "Improved"; a release from before tags only needs room for a bullet.
  const tagged = items.some((i) => i.type);
  return (
    <ul className="space-y-1.5">
      {items.map((i, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a release's lines never reorder
        <li key={n} className={cx("grid items-start gap-2 type-small text-ink", tagged ? "grid-cols-[4.75rem_1fr]" : "grid-cols-[0.75rem_1fr]")}>
          {i.type ? (
            <ChangeTag type={i.type} />
          ) : (
            <span aria-hidden className="text-muted">
              •
            </span>
          )}
          <span className="min-w-0 pt-px">{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A version's heading: "0.6.1 · 19 Oct 2026", with what it is to you (installed, waiting, required). */
function VersionHead({ e, mark }: { e: ChangelogEntry; mark?: string }) {
  return (
    <h3 className="flex flex-wrap items-baseline gap-x-2 type-label text-ink">
      <span className="font-semibold tabular-nums">{e.version}</span>
      {e.date && <span className="type-meta font-normal text-muted">{formatDate(e.date)}</span>}
      {mark && <span className="type-meta font-normal text-muted">· {mark}</span>}
      {e.critical && <span className="type-meta font-medium text-warning-text">· Required update</span>}
    </h3>
  );
}

/**
 * Once after an update: everything new since the version you had, also the versions in between
 * that you skipped. "Got it" (or closing it) marks the update seen.
 */
export function WhatsNewDialog({ from, to, notes, onSeen }: { from: string; to: string; notes?: string; onSeen: (s: UpdateStatus | null) => void }) {
  const [log, setLog] = useState<Changelog | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    void loadChangelog().then(setLog);
  }, []);
  const between = (log?.entries ?? []).filter((e) => newer(e.version, from) && !newer(e.version, to));
  // A copy without a changelog (or an old release): the update's own notes.
  const shown: ChangelogEntry[] = between.length ? between : [{ version: to, date: "", notes: notes ?? "", changes: [], critical: false }];
  const close = () => {
    setOpen(false);
    void markUpdateSeen().then(onSeen);
  };
  if (!open) return null;
  return (
    <Dialog open onClose={close} labelledBy="whats-new-title" initialFocus="[data-autofocus]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 id="whats-new-title" className="type-subheading font-semibold">
            What's new in RawJobs
          </h2>
          <p className="type-meta text-muted tabular-nums">
            {from} → {to}
          </p>
        </div>
        <div className="mt-4 max-h-[min(60dvh,28rem)] space-y-5 overflow-y-auto pr-1">
          {log === null ? (
            <p className="flex items-center gap-2 type-small text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : (
            shown.map((e) => (
              <section key={e.version} className="space-y-2">
                {shown.length > 1 && <VersionHead e={e} />}
                <ReleaseList notes={e.notes} changes={e.changes} />
                {!e.notes.trim() && !e.changes.length && <p className="type-small text-muted">Fixes and small improvements.</p>}
              </section>
            ))
          )}
        </div>
        <div className="mt-5 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => {
              close();
              location.hash = "#settings?section=release-notes";
            }}
            className="self-center type-small text-muted underline underline-offset-2 hover:text-ink"
          >
            All release notes
          </button>
          <Button variant="primary" data-autofocus onClick={close}>
            Got it
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}

const newer = (a: string, b: string) => {
  const p = (v: string) => {
    const [main, pre] = v.replace(/^v/, "").split("-", 2);
    return { n: main!.split(".").map(Number), pre };
  };
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0);
  if (x.pre === y.pre) return false;
  if (!x.pre) return true;
  if (!y.pre) return false;
  return x.pre > y.pre;
};

const FILTERS: { value: "all" | ReleaseChange["type"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "improved", label: "Improved" },
  { value: "fixed", label: "Fixed" },
];
const PAGE = 10;

/** Settings → About → Release notes: every version up to yours, the one waiting first. */
export function ReleaseNotes() {
  const [log, setLog] = useState<Changelog | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    void loadChangelog().then(setLog);
    const again = () => void loadChangelog().then(setLog);
    window.addEventListener("rawjobs:update-status", again);
    return () => window.removeEventListener("rawjobs:update-status", again);
  }, []);
  if (!log)
    return (
      <p className="flex items-center gap-2 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  const all = [...(log.upcoming ? [log.upcoming] : []), ...log.entries];
  if (!all.length) return <p className="type-small text-muted">Release notes come with installed copies of RawJobs. All releases are on GitHub.</p>;
  // Under a type filter, only versions that have such a change.
  const visible = all.filter((e) => filter === "all" || e.changes.some((c) => c.type === filter));
  return (
    <div className="space-y-4">
      <Segmented label="Show changes" value={filter} onChange={setFilter} options={FILTERS} />
      {visible.length === 0 && <p className="type-small text-muted">No {filter} changes yet.</p>}
      <ol className="divide-y divide-line">
        {visible.slice(0, shown).map((e) => (
          <li key={e.version} className="space-y-2 py-3 first:pt-0">
            <VersionHead e={e} mark={e.version === log.current ? "Installed" : e === log.upcoming ? "Ready to install" : undefined} />
            <ReleaseList notes={e.notes} changes={e.changes} filter={filter} />
          </li>
        ))}
      </ol>
      {visible.length > shown && (
        <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
          Show older versions
        </Button>
      )}
    </div>
  );
}

/**
 * The header's Update pill, like the Claude desktop app's: there once a new version is downloaded
 * and ready (or being got), and one click updates. While a scan runs, it updates when the scan is
 * done. A required update keeps its window (Updates.tsx); the pill then opens nothing new.
 */
export function UpdatePill() {
  const { status, setStatus } = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const a = status?.available;
  const waiting = status?.state === "waiting";
  // A required update asks in its own window (RequiredUpdate); once you said yes during a scan, the
  // pill is where it waits.
  if (!status?.installed || !a || status.tooOld || (a.critical && !waiting)) return null;
  const updating = busy || status.state === "updating";
  const click = async () => {
    setBusy(true);
    const s = await updateNow();
    if (s) setStatus(s);
    announceUpdateStatus();
    setBusy(false);
  };
  const label = updating ? "Updating…" : waiting ? "Update after scan" : `Update to ${a.version}`;
  const hint = waiting
    ? `RawJobs ${a.version} installs as soon as the scan that's running is done.`
    : `RawJobs ${a.version} is ${a.ready ? "downloaded and ready" : "out"}. Updating takes a few seconds; your data stays as it is.`;
  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={updating || waiting}
      title={hint}
      aria-label={`${label}. ${hint}`}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-control bg-raised px-2 type-label text-ink transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:text-muted"
    >
      {/* The new dot (the app's mark for something new), then what clicking does. */}
      {!updating && !waiting && <span className="rj-dot" aria-hidden />}
      {updating || waiting ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowDownToLine className="size-3.5" aria-hidden />}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
