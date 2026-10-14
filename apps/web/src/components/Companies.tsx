import { companyLabel, displayName } from "@rawjobs/core/display-name";
import { safeUrl } from "@rawjobs/core/text";
import { Clock, ExternalLink, EyeOff, RefreshCw, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { BoardMove } from "@rawjobs/core/schema";
import { careersUrl } from "@rawjobs/core/detect";
import { keyOf, type CompanyRef } from "../lib/companies";
import { nameRank } from "../lib/companySearch";
import type { DataMeta } from "../lib/data";
import { atsLabel, radarCompanyHash } from "../lib/filters";
import { formatDateTime, timeAgo } from "../lib/format";
import {
  barsOf,
  barsSummary,
  filterCounts,
  isQuiet,
  matchesFilter,
  MY_PAGE,
  needsAttention,
  pageOf,
  problemOf,
  QUIET_SCANS,
  quietOf,
  type Bar,
  type Filter,
  type Problem,
  type Quiet,
  type Seen,
} from "../lib/myCompanies";
import type { CompanyRow } from "../lib/setup";
import { Chip, ChipGroup } from "./primitives";
import { Button, Card, cx, IconButton, Pagination, Select } from "./ui";
import { UpdateLink } from "./UpdateLink";

type Row = {
  r: CompanyRow;
  key: string;
  /** Position in your list: later is more recently added. */
  index: number;
  /** Not saved yet. */
  isNew: boolean;
  /** Opens the Radar on this company's jobs. */
  radar: string;
  bars: Bar[];
  problem: Problem;
  /** A board the last scan found under the same name: maybe its new careers page (you check, then choose). */
  moved?: BoardMove;
  quiet: Quiet;
  isQuiet: boolean;
};

/** A company hidden from the Radar and suggestions: muted in your config (by key) or on the Radar (by name). */
export type HiddenCompany = { key?: string; name?: string };

type Sort = "attention" | "name" | "recent";

/** Newest first: the company's health in each scan that included it. */
function healthOf(meta: DataMeta | undefined, key: string): Seen[] {
  const out: Seen[] = [];
  for (const run of meta?.runs ?? []) {
    const h = run.health.find((x) => keyOf(x) === key);
    if (h) out.push({ h, at: run.startedAt });
  }
  return out;
}

/** "Oct 9" (the year only when it isn't this one). */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
};

const BAR_CLASS: Record<Bar["state"], string> = { worked: "h-4 bg-ink", failed: "h-4 bg-danger", none: "h-1 bg-line" };
const BAR_WORD: Record<Bar["state"], string> = { worked: "worked", failed: "failed", none: "not checked" };

/** One bar per recent scan (health only: worked, failed, not checked), plus the same as text for screen readers. */
function ScanBars({ bars }: { bars: Bar[] }) {
  return (
    <div className="flex h-4 items-end gap-0.5">
      <span className="sr-only">{barsSummary(bars)}</span>
      {bars.map((b) => (
        <span key={b.at} aria-hidden title={`${formatDateTime(b.at)}: ${BAR_WORD[b.state]}`} className={cx("w-1.5 rounded-sm", BAR_CLASS[b.state])} />
      ))}
    </div>
  );
}

function Legend() {
  const item = (state: Bar["state"], label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("inline-block w-1.5 rounded-sm", BAR_CLASS[state])} />
      {label}
    </span>
  );
  return (
    <p className="flex flex-wrap items-end gap-x-4 gap-y-1 type-meta text-muted">
      <span className="sr-only">Scan bars:</span>
      {item("worked", "Worked")}
      {item("failed", "Failed")}
      {item("none", "Not checked")}
    </p>
  );
}

/**
 * My companies: whether each careers page still works and which need you, with filters, 25 per page.
 * The last scan and hidden companies open in place at the top. Healthy rows carry no status: the
 * bars show their last five scans. A table from md up; stacked rows on phones.
 */
export function MyCompanies({
  rows: list,
  savedKeys,
  meta,
  jobNames,
  query = "",
  noMatch,
  onRemove,
  onRemoveMany,
  onRestore,
  onScan,
  scanning,
  onPasteLink,
  onUpdateLink,
  dismissedMoves,
  onDismissMove,
  hidden = [],
  onShowAgain,
  attention = 0,
  showHidden = 0,
  empty,
}: {
  rows: CompanyRow[];
  savedKeys: Set<string>;
  meta?: DataMeta;
  /** The names the Radar's jobs use for each company key (a scan and the directory can differ), for the Radar link. */
  jobNames?: ReadonlyMap<string, readonly string[]>;
  /** Shows only your companies whose name (raw or clean) matches this (the page's search). */
  query?: string;
  /** Shown instead of the list when none of your companies match the search (and the filter is All). */
  noMatch?: ReactNode;
  onRemove: (key: string) => void;
  /** Removes several at once (the quiet banner); the banner offers Undo, via onRestore. */
  onRemoveMany: (keys: string[]) => void;
  /** Puts removed companies back (the quiet banner's Undo). */
  onRestore?: (rows: CompanyRow[]) => void;
  /** Scan now: "Check again" on a company that didn't answer. */
  onScan?: () => void;
  scanning?: boolean;
  /** Opens Add by link: "Paste new link" on a company whose careers page wasn't found. */
  onPasteLink?: () => void;
  /** "Use this link" on a company whose careers page wasn't found, for the board the last scan suggested. */
  /** "Update link": the new board you checked and chose for a company whose careers page stopped working. */
  onUpdateLink?: (key: string, to: CompanyRef, opts: { otherName?: string }) => void;
  /** Suggested new pages you said aren't the company's ("old key>new key"), not offered again. */
  dismissedMoves?: ReadonlySet<string>;
  /** "Not this one" on a suggested new page (the caller remembers it and offers Undo). */
  onDismissMove?: (move: BoardMove) => void;
  hidden?: HiddenCompany[];
  onShowAgain?: (h: HiddenCompany) => void;
  /** Above 0 when a "failing" link was followed; each new value shows Needs attention. */
  attention?: number;
  /** Above 0 when "See hidden companies" was followed; each new value opens the Hidden panel. */
  showHidden?: number;
  /** Shown instead of the list when there are no companies (what your scan covers without them). */
  empty?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>(attention ? "attention" : "all");
  const [sort, setSort] = useState<Sort>("attention");
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<"runs" | "hidden" | null>(showHidden ? "hidden" : null);
  /** The quiet companies the banner just removed, until Undo or the next change of list. */
  const [removed, setRemoved] = useState<CompanyRow[] | null>(null);
  const ids = useId();
  /** The row whose "Update link" panel is open (one at a time). */
  const [editing, setEditing] = useState<{ id: string; url?: string; note?: string } | null>(null);
  /** Rows just given a new link: they stay in view, saying so, until the filter changes. */
  const [updated, setUpdated] = useState<ReadonlySet<string>>(new Set());
  /** The "Update link" button that opened the panel, where focus goes back on Cancel or Escape. */
  const opener = useRef<HTMLButtonElement | null>(null);
  const md = useMedia("(min-width: 768px)");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filter is the trigger
  useEffect(() => setUpdated(new Set()), [filter]);
  useEffect(() => {
    if (attention) setFilter("attention");
  }, [attention]);
  useEffect(() => {
    if (showHidden) setPanel("hidden");
  }, [showHidden]);
  // A new filter, sort or search starts at page 1.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers
  useEffect(() => setPage(1), [filter, sort, query]);

  const runs = meta?.runs ?? [];
  const rows = useMemo<Row[]>(() => {
    const keys = new Set(list.map(keyOf));
    // The last scan's suggested new boards: only shown, never applied until you choose one.
    const moves = meta?.runs[0]?.moves ?? [];
    return list.map((r, index) => {
      const key = keyOf(r);
      const seen = healthOf(meta, key);
      const quiet = quietOf(seen);
      const problem = problemOf(seen, { unreadable: r.state === "soon", anyScans: !!meta?.runs.length, failingSince: meta?.boardHealth?.[key]?.since });
      const radar = radarCompanyHash(jobNames?.get(key) ?? [r.name || r.slug || companyLabel(r)]);
      return {
        r,
        key,
        index,
        isNew: !savedKeys.has(key),
        radar,
        bars: barsOf(meta?.runs ?? [], (health) => health.find((x) => keyOf(x) === key)),
        problem,
        moved: needsAttention(problem) ? moves.find((m) => keyOf(m.from) === key && !keys.has(keyOf(m.to)) && !dismissedMoves?.has(moveKey(m))) : undefined,
        quiet,
        isQuiet: isQuiet(quiet),
      };
    });
  }, [list, savedKeys, meta, jobNames, dismissedMoves]);
  const facts = rows.map((x) => ({ problem: x.problem, quiet: x.isQuiet }));
  const counts = filterCounts(facts);
  const quiet = rows.filter((x) => x.isQuiet);
  const failedLast = rows.filter((x) => needsAttention(x.problem)).length;
  // The Quiet filter goes once nothing is quiet (after Remove, say).
  const active: Filter = filter === "quiet" && !counts.quiet ? "all" : filter;
  const q = query.trim().toLowerCase();

  const byName = (a: Row, b: Row) => companyLabel(a.r).localeCompare(companyLabel(b.r));
  const rank = (x: Row) => (needsAttention(x.problem) ? 2 : x.problem?.kind === "notChecked" ? 1 : 0);
  const shown = rows
    .filter((x) => (updated.has(x.r.id) || matchesFilter(active, { problem: x.problem, quiet: x.isQuiet })) && (!q || nameRank(q, x.r.name, companyLabel(x.r)) >= 0))
    .sort((a, b) => (sort === "recent" ? b.index - a.index : sort === "attention" ? rank(b) - rank(a) || b.quiet.scans - a.quiet.scans || byName(a, b) : byName(a, b)));
  const { items, page: at } = pageOf(shown, page);

  const removeQuiet = () => {
    setRemoved(quiet.map((x) => x.r));
    onRemoveMany(quiet.map((x) => x.key));
  };
  const undo = () => {
    if (removed) onRestore?.(removed);
    setRemoved(null);
  };
  const toggle = (p: "runs" | "hidden") => setPanel((v) => (v === p ? null : p));
  const runsId = `${ids}-runs`;
  const hiddenId = `${ids}-hidden`;
  const panelId = (x: Row) => `${ids}-update-${x.r.id}`;
  /** "Update link" opens the panel under the row; without a handler, "Paste new link" opens Add by link. */
  const fixLink = (x: Row) =>
    onUpdateLink ? (
      <button
        type="button"
        className={linkClass}
        aria-expanded={editing?.id === x.r.id && !editing.url}
        aria-controls={panelId(x)}
        aria-label={`Update ${companyLabel(x.r)}'s careers link`}
        onClick={(e) => {
          opener.current = e.currentTarget;
          setEditing((v) => (v?.id === x.r.id && !v.url ? null : { id: x.r.id }));
        }}
      >
        Update link
      </button>
    ) : (
      onPasteLink && (
        <button type="button" className={linkClass} onClick={onPasteLink}>
          Paste new link
        </button>
      )
    );
  const status = (x: Row) =>
    updated.has(x.r.id) && !needsAttention(x.problem) ? (
      <span className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium text-ink">Link updated</span>
        <span className="text-muted">Checked on your next scan</span>
      </span>
    ) : (
      <Status problem={x.problem} quiet={x.isQuiet ? x.quiet : undefined} onScan={onScan} scanning={scanning} fixLink={fixLink(x)} suggestion={suggestion(x)} />
    );
  /**
   * A page the last scan found for a company whose careers page fails. "Review" opens the Update link
   * panel with it filled in and checked; nothing changes until "Use this link" there. A same-name guess
   * can be turned down ("Not this one"); a move RawJobs checked for everyone says so.
   */
  const suggestion = (x: Row) => {
    const m = x.moved;
    if (!m || !onUpdateLink) return undefined;
    const name = companyLabel(x.r);
    const url = m.to.careers_url || careersUrl(m.to as never);
    const note = m.checked_at
      ? `Checked by RawJobs on ${shortDate(m.checked_at)}: the old page is gone and this one works. Still make sure it's ${name}.`
      : `Suggested because this ${atsLabel(m.to.ats)} page has the same name. Check it's really ${name} before you use it.`;
    const open = editing?.id === x.r.id && !!editing.url;
    return (
      <>
        <span className="text-muted">{m.checked_at ? `Moved to ${atsLabel(m.to.ats)}, checked by RawJobs` : `May have moved to ${atsLabel(m.to.ats)}`}</span>
        <button
          type="button"
          className={linkClass}
          aria-expanded={open}
          aria-controls={panelId(x)}
          aria-label={`Review ${name}'s possible new careers page`}
          onClick={(e) => {
            opener.current = e.currentTarget;
            setEditing(open ? null : { id: x.r.id, url, note });
          }}
        >
          Review
        </button>
        {!m.checked_at && onDismissMove && (
          <button type="button" className={linkClass} aria-label={`Not ${name}'s new careers page`} onClick={() => onDismissMove(m)}>
            Not this one
          </button>
        )}
      </>
    );
  };
  const yours = new Map(rows.map((x) => [x.key, companyLabel(x.r)]));
  const updatePanel = (x: Row) =>
    editing?.id === x.r.id &&
    onUpdateLink && (
      <UpdateLink
        key={editing.url ?? "blank"}
        initialUrl={editing.url}
        note={editing.note}
        id={panelId(x)}
        name={companyLabel(x.r)}
        oldKey={x.key}
        oldState={x.problem?.kind === "notAnswering" ? "Not answering" : "Not found"}
        oldUrl={/^https?:\/\//.test(x.r.input) ? x.r.input : careersUrl(x.r as never) || undefined}
        yours={new Map([...yours].filter(([k]) => k !== x.key))}
        onClose={() => {
          setEditing(null);
          opener.current?.focus();
        }}
        onUse={(to, opts) => {
          setEditing(null);
          setUpdated((u) => new Set(u).add(x.r.id));
          onUpdateLink(x.key, to, opts);
        }}
      />
    );
  const remove = (x: Row, className?: string) => (
    <IconButton label={`Remove ${companyLabel(x.r)}`} onClick={() => onRemove(x.key)} className={cx("hover:text-danger-text", className)}>
      <X className="size-4" />
    </IconButton>
  );

  return (
    <div className="space-y-3">
      {/* The tab above already says "My companies": the heading is for screen readers, the line says the count. */}
      <h2 className="sr-only">My companies</h2>
      {(rows.length > 0 || hidden.length > 0 || runs.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {rows.length > 0 && (
            <p className="type-small text-ink">
              <span className="tabular">{rows.length.toLocaleString()}</span> compan{rows.length === 1 ? "y" : "ies"}, checked on every scan.
            </p>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-4">
            {runs[0] && (
              <TopLink icon={<Clock className="size-3.5" />} expanded={panel === "runs"} controls={runsId} onClick={() => toggle("runs")}>
                Last scan {timeAgo(runs[0].startedAt)}
                {failedLast > 0 && <span className="text-danger-text"> · {failedLast} failed</span>}
              </TopLink>
            )}
            {hidden.length > 0 && (
              <TopLink icon={<EyeOff className="size-3.5" />} expanded={panel === "hidden"} controls={hiddenId} onClick={() => toggle("hidden")}>
                {hidden.length} hidden
              </TopLink>
            )}
          </span>
        </div>
      )}

      {panel === "runs" && meta && <RecentRuns meta={meta} id={runsId} />}
      {panel === "hidden" && hidden.length > 0 && <HiddenPanel hidden={hidden} onShowAgain={onShowAgain} id={hiddenId} />}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ChipGroup label="Show">
            <Chip pressed={active === "all"} count={counts.all} onClick={() => setFilter("all")}>
              All
            </Chip>
            <Chip pressed={active === "attention"} count={counts.attention} onClick={() => setFilter("attention")}>
              Needs attention
            </Chip>
            {counts.quiet > 0 && (
              <Chip pressed={active === "quiet"} count={counts.quiet} onClick={() => setFilter("quiet")}>
                Quiet
              </Chip>
            )}
            <Chip pressed={active === "new"} count={counts.new} onClick={() => setFilter("new")}>
              Not checked yet
            </Chip>
          </ChipGroup>
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 type-small text-muted">
            <label htmlFor={`${ids}-sort`}>Sort</label>
            <Select id={`${ids}-sort`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="attention">Needs attention first</option>
              <option value="name">A to Z</option>
              <option value="recent">Recently added</option>
            </Select>
          </span>
        </div>
      )}

      {removed ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-raised px-4 py-3 type-small">
          <p>
            Removed {removed.length} quiet compan{removed.length === 1 ? "y" : "ies"}. You can add {removed.length === 1 ? "it" : "them"} back any time.
          </p>
          {onRestore && (
            <Button size="sm" onClick={undo}>
              <Undo2 className="size-3.5" /> Undo
            </Button>
          )}
        </div>
      ) : (
        quiet.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-raised px-4 py-3 type-small">
            <p className="max-w-[80ch]">
              {quiet.length} compan{quiet.length === 1 ? "y has" : "ies have"} had nothing for you in {quiet.length === 1 ? "its" : "their"} last {QUIET_SCANS} scans. Removing{" "}
              {quiet.length === 1 ? "it" : "them"} keeps scans quick.
            </p>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setFilter("quiet")} aria-pressed={active === "quiet"}>
                Review {quiet.length}
              </Button>
              <Button size="sm" onClick={removeQuiet} aria-label={`Remove ${quiet.length} quiet compan${quiet.length === 1 ? "y" : "ies"}`}>
                Remove {quiet.length}
              </Button>
            </span>
          </div>
        )
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-6 type-small text-muted">{empty ?? "You haven't added any companies yet."}</p>
        ) : items.length === 0 && q && noMatch && active === "all" ? (
          <div className="px-4 py-6 type-small">{noMatch}</div>
        ) : items.length === 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 px-4 py-6 type-small text-muted">
            {q ? `None of your companies match “${query.trim()}”.` : active === "attention" ? "Every company answered on the last scan." : "Nothing here."}
            {active !== "all" && (
              <button type="button" className="min-h-6 type-label text-ink underline underline-offset-2 hover:text-muted" onClick={() => setFilter("all")}>
                Show all
              </button>
            )}
          </p>
        ) : (
          <>
            {/* Phones: one row per company, the bars beside the name. */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((x) => (
                <li key={x.r.id} className={cx("flex items-start gap-3 py-2 pl-4 pr-2 type-small", x.isNew && "bg-inset")}>
                  <div className="min-w-0 flex-1 space-y-1 py-1">
                    <div className="flex items-center justify-between gap-3">
                      <NameCell x={x} />
                      <ScanBars bars={x.bars} />
                    </div>
                    {status(x)}
                    {!md && updatePanel(x)}
                  </div>
                  {remove(x, "shrink-0")}
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <table className="w-full type-small">
                <thead className="border-b border-line text-left type-label text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Company</th>
                    <th className="w-32 px-3 py-2.5 font-medium">Last {Math.min(5, Math.max(1, runs.length))} scans</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="w-10 px-2 py-2.5">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <Fragment key={x.r.id}>
                      <tr className={cx("border-b border-line last:border-b-0", x.isNew && "bg-inset", md && editing?.id === x.r.id && "border-b-0")}>
                        <td className="px-4 py-2.5">
                          <NameCell x={x} />
                        </td>
                        <td className="px-3 py-2.5">
                          <ScanBars bars={x.bars} />
                        </td>
                        <td className="px-3 py-2.5">{status(x)}</td>
                        <td className="px-2 py-2.5 text-right">{remove(x)}</td>
                      </tr>
                      {md && editing?.id === x.r.id && (
                        <tr className="border-b border-line last:border-b-0">
                          <td colSpan={4} className="px-4 pb-3">
                            {updatePanel(x)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {rows.length > 0 && (
          <div className="space-y-2 border-t border-line px-4 py-2.5">
            {shown.length > MY_PAGE ? <Pagination page={at} pageSize={MY_PAGE} total={shown.length} onPage={setPage} /> : null}
            {runs.length > 0 && <Legend />}
          </div>
        )}
      </Card>
    </div>
  );
}

/** A quiet link at the top right that opens its panel in place. */
function TopLink({ icon, expanded, controls, onClick, children }: { icon: ReactNode; expanded: boolean; controls: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1.5 type-small text-muted underline-offset-2 hover:text-ink hover:underline"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

/** The name opens the company's jobs on your Radar (they live there, not here); the icon opens its careers page. */
function NameCell({ x }: { x: Row }) {
  const name = companyLabel(x.r);
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-medium">
      <a
        href={x.radar}
        onClick={() => window.scrollTo({ top: 0 })}
        className="min-w-0 truncate underline-offset-2 hover:underline"
        aria-label={`${name}: see its jobs on your Radar`}
        title={`See ${name} on your Radar`}
      >
        {name}
      </a>
      {/^https?:/.test(x.r.input) && (
        <a
          href={safeUrl(x.r.input)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"
          aria-label={`${name} careers page`}
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

const linkClass = "inline-flex min-h-6 items-center gap-1 type-label text-ink underline underline-offset-2 hover:text-muted disabled:opacity-50";

/** Words only when something is wrong, each with what to do; a quiet company says so quietly. Healthy rows: nothing. */
function Status({
  problem,
  quiet,
  onScan,
  scanning,
  fixLink,
  suggestion,
}: {
  problem: Problem;
  quiet?: Quiet;
  onScan?: () => void;
  scanning?: boolean;
  /** "Update link" (or "Paste new link"): shown when the careers page is gone, or hasn't answered for a few scans. */
  fixLink?: ReactNode;
  /** A page the last scan found that may be the new one, with Review (and Not this one). */
  suggestion?: ReactNode;
}) {
  const line = (word: string, detail?: string, action?: ReactNode, tone: "danger" | "muted" = "muted") => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className={cx("font-medium", tone === "danger" ? "text-danger-text" : "text-ink")}>{word}</span>
      {detail && <span className="text-muted">{detail}</span>}
      {action}
    </span>
  );
  if (!problem) return quiet ? <span className="text-muted">Nothing for you in the last {quiet.scans} scans</span> : null;
  const checkAgain = onScan && (
    <button type="button" className={linkClass} onClick={onScan} disabled={scanning}>
      <RefreshCw className="size-3" /> Check again
    </button>
  );
  /** A month or more: say so, the date still shown. */
  const lasting = (p: { since: string; chronic?: boolean }) => (p.chronic ? `for over a month (since ${shortDate(p.since)})` : `since ${shortDate(p.since)}`);
  switch (problem.kind) {
    case "notFound":
      return line(
        "Careers page not found",
        lasting(problem),
        <>
          {suggestion}
          {fixLink}
        </>,
        "danger",
      );
    case "notAnswering":
      return line(
        "Not answering",
        problem.scans > 1 || problem.chronic ? lasting(problem) : "on the last scan",
        // A month without an answer: a new page is likelier to help than another try, so that comes first.
        problem.chronic ? (
          <>
            {suggestion}
            {fixLink}
            {checkAgain}
          </>
        ) : (
          <>
            {checkAgain}
            {suggestion}
            {fixLink}
          </>
        ),
        "danger",
      );
    case "cantRead":
      return line("Can't read this hiring system yet");
    case "notChecked":
      return line("Not checked yet", problem.afterLastScan ? "Added after the last scan" : "Checked on your next scan");
  }
}

/** The latest scans: when, how many companies, how many failed, how long. Opened from "Last scan" at the top. */
export function RecentRuns({ meta, id }: { meta: DataMeta; id?: string }) {
  if (!meta.runs.length) return null;
  return (
    <Card className="overflow-hidden" id={id}>
      <h3 className="px-4 pt-3 pb-2 type-small font-semibold">Recent scans</h3>
      <ul className="divide-y divide-line border-t border-line type-small">
        {meta.runs.slice(0, 10).map((r) => {
          const failed = r.health.filter((h) => !h.ok && !h.unsupported).length;
          const secs = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;
          return (
            <li key={r.startedAt} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <span className="w-32 text-muted">{formatDateTime(r.startedAt)}</span>
              <span className="tabular min-w-0 flex-1">
                {r.health.length.toLocaleString()} compan{r.health.length === 1 ? "y" : "ies"} checked
                {failed > 0 && <span className="text-danger-text">, {failed} failed</span>}.{r.partial && <span className="text-muted"> Stopped before the end.</span>}
              </span>
              <span className="tabular text-muted">{secs.toFixed(0)} s</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Hidden companies, opened from "N hidden" at the top, each with Show again. */
function HiddenPanel({ hidden, onShowAgain, id }: { hidden: HiddenCompany[]; onShowAgain?: (h: HiddenCompany) => void; id: string }) {
  return (
    <Card className="p-4" id={id}>
      <h3 className="type-small font-semibold">Hidden companies</h3>
      <p className="mt-0.5 type-small text-muted">Their jobs don't show on your Radar, and scans skip them.</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {hidden.map((h) => {
          const name = h.name ? displayName(h.name) : h.key;
          return (
            <li key={h.key ?? h.name} className="inline-flex h-8 items-center gap-2 rounded-md border border-line pl-2.5 pr-1.5 type-small">
              <span className="font-medium">{name}</span>
              {onShowAgain && (
                <button type="button" className="min-h-6 type-label text-ink underline underline-offset-2 hover:text-muted" aria-label={`Show ${name} again`} onClick={() => onShowAgain(h)}>
                  Show again
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Whether a media query matches, kept up to date (true where matchMedia doesn't exist). */
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      if (typeof matchMedia !== "function") return () => {};
      const m = matchMedia(query);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => typeof matchMedia !== "function" || matchMedia(query).matches,
  );
}

/** A suggested move as "old key>new key", what "Not this one" remembers. */
export const moveKey = (m: Pick<BoardMove, "from" | "to">) => `${keyOf(m.from)}>${keyOf(m.to)}`;
