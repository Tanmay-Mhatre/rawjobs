import type { ChangelogEntry, ReleaseChange } from "@rawjobs/core/release-notes";
import { releaseItems } from "@rawjobs/core/release-notes";
import { ArrowDownToLine, ChevronDown, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/format";
import { settingsHash } from "./settings/registry";
import { announceUpdateStatus, loadChangelog, markUpdateSeen, updateNow, useUpdateStatus, type Changelog, type UpdateStatus } from "../lib/update";
import { Dialog } from "./Dialog";
import { Button, Card, cx, Segmented } from "./ui";
import { Anchor, ChangeRows, ChangeTag, Head, Points, sortedItems, VersionLine } from "./UpdateParts";
import { toast } from "./Toast";

/**
 * What changed, version by version: the tag on each line (New, Improved, Fixed), a release's list,
 * the "What's new" window after an update, and Settings → About → Release notes. The notes come from
 * each release's tag message (packages/core/src/release-notes.ts); the bundle carries every version's
 * (changelog.json), so a copy knows what changed in every version up to its own.
 */

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
 * Once after an update, in the same look as the required-update window: the app icon and
 * "0.6.0 → 0.6.1 · Updated", then the changes, New first. When versions were skipped on the way
 * ("What's new since 0.5.3"), each version gets its own group, newest first, with its first two
 * lines, so a version's new features aren't hidden behind the next one's fixes; "See all n
 * changes" opens the rest. "Got it" (or Escape, or the backdrop) marks the update seen.
 */
export function WhatsNewDialog({ from, to, notes, onSeen }: { from: string; to: string; notes?: string; onSeen: (s: UpdateStatus | null) => void }) {
  const [log, setLog] = useState<Changelog | null>(null);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadChangelog().then(setLog);
  }, []);
  const between = (log?.entries ?? []).filter((e) => newer(e.version, from) && !newer(e.version, to));
  // A copy without a changelog (or an old release): the update's own notes.
  const shown: ChangelogEntry[] = between.length ? between : [{ version: to, date: "", notes: notes ?? "", changes: [], critical: false }];
  const groups = shown.map((e) => ({ e, items: sortedItems(e.notes, e.changes) })).filter((g) => g.items.length);
  const skipped = groups.length > 1;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const close = () => {
    setOpen(false);
    void markUpdateSeen().then(onSeen);
  };
  if (!open) return null;
  return (
    <Dialog open onClose={close} labelledBy="whats-new-title" describedBy="whats-new-desc" initialFocus="[data-autofocus]" className="max-w-[30rem]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <Head
          id="whats-new-title"
          anchor={<Anchor kind="mark" />}
          title={skipped ? `What's new since ${from}` : `What's new in ${to}`}
          from={from}
          to={to}
          label={skipped ? `${groups.length} versions` : "Updated"}
        />
        <p id="whats-new-desc" className="mt-4 type-body">
          Updated. Your data is as it was.
        </p>
        <div className="mt-6 max-h-[min(50dvh,24rem)] overflow-y-auto border-t border-hairline pt-4">
          {log === null ? (
            <p className="flex items-center gap-2 type-small text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : !groups.length ? (
            <p className="type-small text-muted">Fixes and small improvements.</p>
          ) : !skipped ? (
            <ChangeRows items={groups[0]!.items} />
          ) : (
            <>
              <div className="space-y-4">
                {groups.map((g) => (
                  <section key={g.e.version} aria-labelledby={`wn-${g.e.version}`}>
                    <h3 id={`wn-${g.e.version}`} className="mb-2 flex items-baseline gap-2 type-label text-ink">
                      <span className="font-semibold tabular-nums">{g.e.version}</span>
                      {g.e.date && <span className="type-meta font-normal text-muted">{formatDate(g.e.date)}</span>}
                    </h3>
                    {/* Two lines per version until See all, so one version's fixes don't hide another's new features. */}
                    <ChangeRows items={all ? g.items : g.items.slice(0, 2)} />
                  </section>
                ))}
              </div>
              {total > groups.reduce((n, g) => n + Math.min(2, g.items.length), 0) && (
                <button
                  type="button"
                  aria-expanded={all}
                  onClick={() => setAll((v) => !v)}
                  className="-ml-2 mt-2 inline-flex h-7 items-center gap-1 rounded-md px-2 type-label text-muted hover:bg-hover hover:text-ink"
                >
                  {all ? "Show fewer" : `See all ${total} changes`}
                  <ChevronDown className={cx("size-4 transition-transform duration-150 motion-reduce:transition-none", all && "rotate-180")} aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
        <div className="mt-6 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => {
              close();
              location.hash = settingsHash("whats-new");
            }}
            className="self-center type-small text-muted underline underline-offset-2 hover:text-ink"
          >
            All release notes
          </button>
          <Button variant="primary" data-autofocus onClick={close} className="max-sm:h-11">
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
 * and ready, and one click (or tap) updates. Hovering it, or tabbing to it, shows a small card with
 * what's in it; nothing on the card needs a click, so touch loses nothing. Every click gets an
 * answer where you clicked: Updating (the card over the page, ServerNotices), a toast when a scan
 * has to finish first, or a card under the pill when RawJobs couldn't get the update.
 * A required update keeps its own window (RequiredUpdate); the pill only shows it waiting.
 */
export function UpdatePill() {
  const { status, setStatus } = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const a = status?.available;
  const waiting = status?.state === "waiting";
  if (!status?.installed || !a || status.tooOld || (a.critical && !waiting)) return null;
  const updating = busy || status.state === "updating";
  const click = async () => {
    setHint(false);
    setFailed(null);
    setBusy(true);
    const s = await updateNow();
    if (s) setStatus(s);
    announceUpdateStatus();
    setBusy(false);
    if (s?.state === "waiting") toast({ message: "RawJobs updates when the scan finishes. Keep working." });
    else if (s && s.state === "idle" && s.error) setFailed(s.error);
  };
  const label = updating ? "Updating…" : waiting ? "Update after scan" : `Update to ${a.version}`;
  const top = sortedItems(a.notes, a.changes).slice(0, 2);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only shows the preview; the button inside is the control
    <div className="relative" onMouseEnter={() => setHint(!failed)} onMouseLeave={() => setHint(false)}>
      <button
        type="button"
        onClick={() => void click()}
        onFocus={() => setHint(!failed)}
        onBlur={() => setHint(false)}
        onKeyDown={(e) => e.key === "Escape" && setHint(false)}
        disabled={updating || waiting}
        aria-describedby={hint && !updating && !waiting ? "update-pill-preview" : undefined}
        title={waiting ? `RawJobs ${a.version} installs as soon as the scan that's running is done.` : undefined}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-control bg-raised px-2 type-label text-ink transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:text-muted"
      >
        {/* The new dot (the app's mark for something new), then what clicking does. */}
        {!updating && !waiting && <span className="rj-dot" aria-hidden />}
        {updating || waiting ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowDownToLine className="size-3.5" aria-hidden />}
        <span className="whitespace-nowrap">{label}</span>
      </button>
      {hint && !updating && !waiting && !failed && (
        <div id="update-pill-preview" role="tooltip" className={POP}>
          <div className="flex items-center gap-3">
            <Anchor kind="mark" size="sm" />
            <div className="min-w-0">
              <p className="type-label text-ink">RawJobs {a.version} is ready</p>
              <VersionLine from={status.current} to={a.version} />
            </div>
          </div>
          {top.length > 0 && (
            <div className="mt-3">
              <ChangeRows items={top} />
            </div>
          )}
          <p className="mt-3 border-t border-hairline pt-2 type-meta text-muted">Click to update. Takes a few seconds. Your data stays.</p>
        </div>
      )}
      {failed && <CouldntUpdate to={a.version} from={status.current} error={failed} onDismiss={() => setFailed(null)} onRetry={() => void click()} />}
    </div>
  );
}

/** Under the pill, on phones across the page under the header. */
const POP = "absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-line bg-overlay p-3 text-left shadow-l2";

/** The pill's click didn't get the update (offline, GitHub away): what happened, Try again, right where you clicked. */
function CouldntUpdate({ from, to, error, onDismiss, onRetry }: { from: string; to: string; error: string; onDismiss: () => void; onRetry: () => void }) {
  // Focus goes to Try again, so Enter retries and Escape dismisses.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => card.current?.querySelector<HTMLButtonElement>("[data-retry]")?.focus(), []);
  const offline = /^Couldn't reach GitHub/.test(error);
  return (
    <div ref={card} role="alert" aria-labelledby="couldnt-update-title" className={POP} onKeyDown={(e) => e.key === "Escape" && onDismiss()}>
      <div className="flex items-center gap-3">
        <Anchor kind="alert" size="sm" />
        <div className="min-w-0">
          <p id="couldnt-update-title" className="type-label text-ink">
            Couldn't update to {to}
          </p>
          <p className="type-small text-muted">Not installed</p>
        </div>
      </div>
      <p className="mt-3 type-small text-ink">{offline ? "RawJobs couldn't reach GitHub. Check your internet connection, then try again." : error}</p>
      <Points className="mt-2" items={[[ShieldCheck, `Nothing changed. You're still on ${from}.`]]} />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" variant="primary" data-retry onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden /> Try again
        </Button>
      </div>
    </div>
  );
}
