import { safeUrl } from "@rawjobs/core/text";
import { Clock, ExternalLink, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ATS_LABEL, keyOf } from "../lib/companies";
import type { CompanyHealth, DataMeta } from "../lib/data";
import { formatDate, formatDateTime, timeAgo } from "../lib/format";
import type { CompanyRow } from "../lib/setup";
import { Status as BoardStatus } from "./primitives";
import { Button, Card, cx, IconButton, Segmented } from "./ui";

/** A company with no jobs for you in at least this many scans in a row, over at least QUIET_DAYS, gets a "remove?" flag. */
export const QUIET_SCANS = 10;
/** ...so ten quick scans in one afternoon don't count. */
export const QUIET_DAYS = 7;

const isQuiet = (q: Row["quiet"], now = Date.now()) => q.scans >= QUIET_SCANS && !!q.since && now - Date.parse(q.since) >= QUIET_DAYS * 86_400_000;

type Row = {
  r: CompanyRow;
  key: string;
  /** Not saved yet. */
  isNew: boolean;
  forYou: number;
  last?: { h: CompanyHealth; at: string };
  history: (CompanyHealth | undefined)[];
  /** Scans in a row (newest first) that found nothing for you, and since when. */
  quiet: { scans: number; since?: string };
};

/** Newest first: the company's health in each scan that included it. */
function healthOf(meta: DataMeta | undefined, key: string): { h: CompanyHealth; at: string }[] {
  const out: { h: CompanyHealth; at: string }[] = [];
  for (const run of meta?.runs ?? []) {
    const h = run.health.find((x) => keyOf(x) === key);
    if (h) out.push({ h, at: run.startedAt });
  }
  return out;
}

function quietOf(seen: { h: CompanyHealth; at: string }[]): Row["quiet"] {
  let scans = 0;
  let since: string | undefined;
  for (const { h, at } of seen) {
    if (!h.ok || h.matches > 0) break;
    scans++;
    since = at;
  }
  return { scans, since };
}

const failing = (row: Row) => !!row.last && !row.last.h.ok && !row.last.h.unsupported;

const atsName = (ats: string) => ATS_LABEL[ats] ?? ats;

/** "Last 14 scans: 12 OK, 2 failed" for screen readers (the bars are visual only). */
function historySummary(history: Row["history"]): string {
  const seen = history.filter(Boolean) as CompanyHealth[];
  if (!seen.length) return "Not scanned yet";
  const failed = seen.filter((h) => !h.ok && !h.unsupported).length;
  const unsupported = seen.filter((h) => h.unsupported).length;
  const found = seen.filter((h) => h.ok && h.matches > 0).length;
  return [
    `Last ${seen.length} scan${seen.length === 1 ? "" : "s"}: ${seen.length - failed - unsupported} OK`,
    failed && `${failed} failed`,
    unsupported && `${unsupported} not supported`,
    found && `${found} with jobs for you`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Coloured bars, one per recent scan, plus the same as text for screen readers. */
function ScanHistory({ history }: { history: Row["history"] }) {
  return (
    <div className="flex h-5 items-end gap-0.5">
      <span className="sr-only">{historySummary(history)}</span>
      {history.map((h, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
          key={i}
          aria-hidden
          title={!h ? "Not in this scan" : h.ok ? `${h.jobsFound} jobs, ${h.matches} for you` : h.unsupported ? "Not supported yet" : "Scan failed"}
          className={cx("w-1.5 rounded-md", !h ? "h-1 bg-line" : h.unsupported ? "h-1.5 bg-warning/50" : !h.ok ? "h-5 bg-danger" : h.matches > 0 ? "h-5 bg-ink" : "h-2.5 bg-line")}
        />
      ))}
    </div>
  );
}

/**
 * My companies: what each has for you right now, whether its careers page still works, and which
 * ones haven't had anything for you in a while (remove them, so scans stay quick and polite).
 * A table from md up; stacked cards on phones so every action stays on screen.
 */
export function MyCompanies({
  rows: list,
  savedKeys,
  meta,
  forYou,
  onRemove,
  onRemoveMany,
  onScan,
  scanning,
  attention = 0,
  empty,
}: {
  rows: CompanyRow[];
  savedKeys: Set<string>;
  meta?: DataMeta;
  forYou: ReadonlyMap<string, number>;
  onRemove: (key: string) => void;
  onRemoveMany: (keys: string[]) => void;
  /** Scan now (offered when a company's last scan failed). */
  onScan?: () => void;
  scanning?: boolean;
  /** Above 0 when a "failing" link was followed; each new value sorts by Needs attention. */
  attention?: number;
  /** Shown instead of the list when there are no companies (what your scan covers without them). */
  empty?: ReactNode;
}) {
  const [sort, setSort] = useState<"jobs" | "name" | "attention">(attention ? "attention" : "jobs");
  useEffect(() => {
    if (attention) setSort("attention");
  }, [attention]);
  const rows = useMemo<Row[]>(
    () =>
      list.map((r) => {
        const key = keyOf(r);
        const seen = healthOf(meta, key);
        const history = (meta?.runs ?? [])
          .slice(0, 14)
          .map((run) => run.health.find((x) => keyOf(x) === key))
          .reverse();
        return { r, key, isNew: !savedKeys.has(key), forYou: forYou.get(key) ?? 0, last: seen[0], history, quiet: quietOf(seen) };
      }),
    [list, savedKeys, meta, forYou],
  );
  const quiet = rows.filter((x) => x.forYou === 0 && isQuiet(x.quiet));
  const broken = rows.filter(failing).length;
  const sorted = [...rows].sort((a, b) => {
    if (sort === "name") return (a.r.name || "").localeCompare(b.r.name || "");
    if (sort === "attention") return Number(failing(b)) - Number(failing(a)) || b.quiet.scans - a.quiet.scans || a.forYou - b.forYou;
    return b.forYou - a.forYou || (b.last?.h.jobsFound ?? 0) - (a.last?.h.jobsFound ?? 0);
  });
  const oldestQuiet = quiet
    .map((x) => x.quiet.since)
    .filter(Boolean)
    .sort()[0];

  return (
    <Card className="overflow-hidden">
      {/* The tab above already says "My companies": the heading is for screen readers, the line says the count. */}
      <h2 className="sr-only">My companies</h2>
      {rows.length > 0 && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="type-small text-ink">
            <span className="tabular">{rows.length.toLocaleString()}</span> compan{rows.length === 1 ? "y" : "ies"}, checked on every scan.
            {broken > 0 && <span className="text-danger-text"> Last scan failed for {broken}.</span>}
          </p>
          {rows.length > 1 && (
            <Segmented
              label="Sort My companies"
              value={sort}
              onChange={setSort}
              options={[
                { value: "jobs", label: "Most jobs for you" },
                { value: "attention", label: "Needs attention" },
                { value: "name", label: "A–Z" },
              ]}
            />
          )}
        </header>
      )}

      {quiet.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-warning-subtle/30 px-4 py-2.5 type-small">
          <Clock className="size-4 shrink-0 text-warning-text" />
          <p className="min-w-0 flex-1">
            <b>
              {quiet.length} compan{quiet.length === 1 ? "y has" : "ies have"} had no jobs for you
            </b>{" "}
            <span className="text-muted">
              in {QUIET_SCANS}+ scans in a row over {QUIET_DAYS}+ days{oldestQuiet ? ` (some since ${formatDate(oldestQuiet)})` : ""}. Removing them keeps scans quick; jobs there still reach your
              Radar from the directory.
            </span>
          </p>
          <Button size="sm" onClick={() => onRemoveMany(quiet.map((x) => x.key))} aria-label={`Remove ${quiet.length} quiet compan${quiet.length === 1 ? "y" : "ies"}`}>
            Remove {quiet.length}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-6 type-small text-muted">{empty ?? "You haven't added any companies yet."}</p>
      ) : (
        <>
          {/* Phones: one card per company. */}
          <ul className="divide-y divide-line md:hidden">
            {sorted.map((x) => (
              <li key={x.r.id} className={cx("flex items-start gap-3 px-4 py-3 type-small", x.isNew && "bg-inset")}>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <NameCell x={x} />
                  <p className="type-small text-muted">
                    <span className={cx("tabular", x.forYou > 0 && "font-semibold text-ink")}>{x.forYou || "No"} for you</span>
                    {x.last?.h.ok && <span className="tabular"> · {x.last.h.jobsFound} open jobs</span>}
                  </p>
                  <ScanHistory history={x.history} />
                  <Status row={x} onScan={onScan} scanning={scanning} />
                </div>
                <IconButton label={`Remove ${x.r.name || x.r.slug}`} onClick={() => onRemove(x.key)} className="-mr-1 shrink-0 hover:text-danger-text">
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <table className="w-full type-small">
              <thead className="border-b border-line text-left type-label text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 text-right font-semibold">For you</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Open jobs</th>
                  <th className="px-3 py-2.5 font-medium">Recent scans</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-10 px-2 py-2.5">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((x) => (
                  <tr key={x.r.id} className={cx("border-b border-line last:border-b-0", x.isNew && "bg-inset")}>
                    <td className="px-4 py-2.5">
                      <NameCell x={x} />
                    </td>
                    <td className={cx("tabular px-3 py-2.5 text-right", x.forYou > 0 ? "font-semibold text-ink" : "text-muted")}>{x.forYou || "—"}</td>
                    <td className="tabular px-3 py-2.5 text-right text-muted">{x.last?.h.ok ? x.last.h.jobsFound : "—"}</td>
                    <td className="px-3 py-2.5">
                      <ScanHistory history={x.history} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Status row={x} onScan={onScan} scanning={scanning} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <IconButton label={`Remove ${x.r.name || x.r.slug}`} onClick={() => onRemove(x.key)} className="hover:text-danger-text">
                        <X className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/** Name, careers page link and hiring system. */
function NameCell({ x }: { x: Row }) {
  return (
    <>
      <div className="flex items-center gap-1.5 font-medium">
        {x.r.name || x.r.slug}
        {/^https?:/.test(x.r.input) && (
          <a
            href={safeUrl(x.r.input)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:text-ink"
            aria-label={`${x.r.name || x.r.slug} careers page`}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {x.isNew && <span className="type-small font-normal text-muted">new</span>}
      </div>
      {x.r.ats && <div className="type-small text-muted">Hiring system: {atsName(x.r.ats)}</div>}
    </>
  );
}

function Status({ row, onScan, scanning }: { row: Row; onScan?: () => void; scanning?: boolean }) {
  const { last, r, isNew, quiet } = row;
  const note = (text: string) => <span className="type-small text-muted">{text}</span>;
  if (isNew) return note(r.state === "soon" ? "Not supported yet" : "Not saved yet");
  if (!last) return note(r.state === "soon" ? "Not supported yet" : "Not scanned yet");
  if (last.h.unsupported) return note(`Not supported yet (${atsName(last.h.ats)})`);
  if (!last.h.ok)
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <BoardStatus state="broken" />
          {onScan && (
            <button
              type="button"
              className="inline-flex min-h-6 items-center gap-1 type-label text-ink underline underline-offset-2 hover:text-muted disabled:opacity-50"
              onClick={onScan}
              disabled={scanning}
            >
              <RefreshCw className="size-3" /> Retry
            </button>
          )}
        </div>
        {last.h.error && (
          <details className="max-w-80 type-meta text-muted">
            <summary className="cursor-pointer">Technical details</summary>
            {last.h.error}
          </details>
        )}
      </div>
    );
  // Board status (Healthy or Dormant) as shape + color + word, then the facts in plain text.
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <BoardStatus state={last.h.jobsFound > 0 ? "healthy" : "dormant"} />
      <span className="type-small text-muted">{isQuiet(quiet) && !row.forYou ? `Nothing for you since ${formatDate(quiet.since)}` : `Scanned ${timeAgo(last.at)}`}</span>
    </span>
  );
}

/** The latest scans: how many jobs, matches, and companies scanned beyond yours. Collapsed by default. */
export function RecentRuns({ meta }: { meta: DataMeta }) {
  if (!meta.runs.length) return null;
  return (
    <details className="group overflow-hidden rounded-md border border-line bg-raised">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2.5 type-small font-semibold">
        Recent scans <span className="tabular font-normal text-muted">({Math.min(10, meta.runs.length)})</span>
        {meta.runs[0] && <span className="ml-auto type-meta text-muted">Last scan {timeAgo(meta.runs[0].startedAt)}</span>}
      </summary>
      <ul className="divide-y divide-line border-t border-line type-small">
        {meta.runs.slice(0, 10).map((r) => {
          const failed = r.health.filter((h) => !h.ok && !h.unsupported).length;
          const secs = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;
          return (
            <li key={r.startedAt} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <span className="w-36 text-muted">{formatDateTime(r.startedAt)}</span>
              <span className="tabular text-muted">{r.jobsFound} jobs</span>
              <span className="tabular text-muted">{r.matches} matches</span>
              <span className={cx("tabular", r.newMatches > 0 ? "font-semibold text-ink" : "text-muted")}>{r.newMatches} new</span>
              <span className="tabular text-muted">{r.closed} closed</span>
              {!!r.checked && <span className="tabular text-muted">+{r.checked.toLocaleString()} more companies scanned</span>}
              <span className="tabular text-muted">{secs.toFixed(0)}s</span>
              {failed > 0 && <span className="tabular text-danger-text">{failed} failed</span>}
              {r.partial && <span className="text-muted">Stopped before the end</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
