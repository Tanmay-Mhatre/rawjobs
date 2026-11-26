import { companyLabel } from "@rawjobs/core/display-name";
import { INDUSTRIES, INDUSTRY_BY_ID, INDUSTRY_GROUPS } from "@rawjobs/core/catalog/industries";
import { safeUrl } from "@rawjobs/core/text";
import { ChevronDown, CloudDownload, ExternalLink, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { MATCH } from "@rawjobs/core/company-search";
import { ATS_LABEL, type BrowseAnswer, type CompanyRef, type DirCompany, searchDirectory, SUPPORTED } from "@rawjobs/core/directory-search";
import { canRunLocally } from "../lib/data";
import { useDirectorySearch } from "../lib/directorySearch";
import { DirectoryBar, updateDirectory } from "./DirectoryBar";
import { AddButton } from "./CompanyButtons";
import { Button, cx, Pagination, Select } from "./ui";

const BROWSE_PAGE = 25;

type Props = {
  /** Keys of the companies in your list (saved or not yet). */
  watched: Set<string>;
  /** Bumped after the directory updates (or to retry loading it): asks again. */
  rev: number;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemove: (key: string) => void;
  /** Reload the directory (after an update, or to retry a failed load). */
  onDirectoryUpdated: () => void;
  /** Fit score per company key, from the suggestions (when worked out). */
  fit?: ReadonlyMap<string, number>;
  /** Your industries, offered first in the industry filter. */
  industries?: string[];
  /** The search from the page header (the page has one search box). */
  q: string;
  /** Open "Add by link" for a company the directory doesn't have (named as typed in the search). */
  onAddByLink: (name?: string) => void;
  /** The page's one company count (countCompanies), for the directory bar. */
  companyCount?: number;
};

/** Browse all: the whole directory, filtered by the header search, industry or hiring system. */
export function CompanyFinder({ watched, rev, onAddMany, onRemove, onDirectoryUpdated, fit, industries, q, onAddByLink, companyCount }: Props) {
  return (
    <div className="space-y-4">
      <DirectoryBar onUpdated={onDirectoryUpdated} companies={companyCount} />
      <Browse rev={rev} fit={fit} mine={industries ?? []} watched={watched} onAdd={(c) => void onAddMany([c])} onRemove={onRemove} q={q} onAddByLink={onAddByLink} onReload={onDirectoryUpdated} />
    </div>
  );
}

// ---------- search the whole directory ----------

export { searchDirectory, type DirCompany };

/** Title case for a name typed in lower case ("revolut" is "Revolut"); a name typed with capitals stays as typed. */
export function typedName(q: string): string {
  const s = q.trim().replace(/\s+/g, " ");
  return s === s.toLowerCase() ? s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : s;
}

/** How a search result matched, said plainly ("name starts with “revolut”"); nothing for the exact name. */
function matchWhy(rank: number, term: string): string | undefined {
  if (rank === MATCH.starts) return `name starts with “${term}”`;
  if (rank === MATCH.word) return `a word in the name starts with “${term}”`;
  if (rank === MATCH.contains) return `name contains “${term}”`;
  if (rank === MATCH.close) return "similar spelling";
  return undefined;
}

/** The directory couldn't load: say so, and offer the fix (download it) and a retry. */
function DirectoryMissing({ onReload }: { onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div role="alert" className="space-y-2 rounded-md bg-warning-subtle/50 p-4 type-small">
      <p className="font-medium">The company directory isn't available yet.</p>
      <p className="text-muted">
        {canRunLocally ? "It hasn't been downloaded to this computer. Download it to browse and search every company." : "It couldn't be loaded. Check your connection and try again."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canRunLocally && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote(null);
              const r = await updateDirectory();
              setBusy(false);
              if (r.ok) onReload();
              else setNote(r.text);
            }}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} {busy ? "Updating…" : "Update directory"}
          </Button>
        )}
        <Button size="sm" onClick={onReload} disabled={busy}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      </div>
      {note && <p className="type-small text-danger-text">{note}</p>}
    </div>
  );
}

/** The search couldn't answer (the local server is restarting, say): offer a retry. */
function SearchFailed({ onReload }: { onReload: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-md bg-warning-subtle/50 p-4 type-small">
      <p className="font-medium">Companies couldn't be loaded.</p>
      <p className="text-muted">RawJobs may still be starting. Try again in a moment.</p>
      <Button size="sm" onClick={onReload}>
        <RefreshCw className="size-3.5" /> Try again
      </Button>
    </div>
  );
}

function Browse({
  rev,
  fit,
  mine,
  watched,
  onAdd,
  onRemove,
  q,
  onAddByLink,
  onReload,
}: {
  rev: number;
  fit?: ReadonlyMap<string, number>;
  mine: string[];
  watched: Set<string>;
  onAdd: (c: DirCompany) => void;
  onRemove: (key: string) => void;
  q: string;
  onAddByLink: (name?: string) => void;
  onReload: () => void;
}) {
  const [system, setSystem] = useState<"all" | "supported" | "soon">("all");
  const [industry, setIndustry] = useState("");
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  const { answer, error, loading, slow } = useDirectorySearch({ q, industry, system, page, pageSize: BROWSE_PAGE }, { watched, fit, rev });

  // Back to page 1 whenever the search or filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: back to page 1 whenever the search or a filter changes: they are the triggers
  useEffect(() => setPage(1), [q, system, industry]);
  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (answer?.missing) return <DirectoryMissing onReload={onReload} />;
  if (error && !loading) return <SearchFailed onReload={onReload} />;

  const term = q.trim();
  const filtered = system !== "all" || !!industry;
  const clearFilters = () => {
    setSystem("all");
    setIndustry("");
  };
  // The last answer stays while the next one loads; placeholders on the first load, and when the next
  // page or search takes a moment (SLOW_MS), so a quick change never flickers.
  const shown = answer && !(loading && slow) ? answer : null;
  // The first search after the app starts waits a few seconds for the search index: say so.
  const preparing = !shown && !!term && !answer?.searchReady;

  return (
    <div className="space-y-3">
      <div ref={top} className="flex scroll-mt-20 flex-wrap items-center gap-2">
        <Select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
          <option value="">All industries</option>
          {mine.length > 0 && (
            <optgroup label="Your industries">
              {INDUSTRIES.filter((i) => mine.includes(i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          )}
          {INDUSTRY_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {INDUSTRIES.filter((i) => i.group === g.id && !mine.includes(i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select value={system} onChange={(e) => setSystem(e.target.value as typeof system)} aria-label="Hiring system">
          <option value="all">Any hiring system</option>
          <option value="supported">Can check now</option>
          <option value="soon">Coming in a later update</option>
        </Select>
      </div>
      {shown && !shown.missing ? (
        <Results answer={shown} term={term} filtered={filtered} clearFilters={clearFilters} onAddByLink={onAddByLink} goTo={goTo} mine={mine} watched={watched} onAdd={onAdd} onRemove={onRemove} />
      ) : (
        <BrowseSkeleton preparing={preparing} />
      )}
    </div>
  );
}

/** One page of Browse all: the count line, the rows and the pages. */
function Results({
  answer,
  term,
  filtered,
  clearFilters,
  onAddByLink,
  goTo,
  ...line
}: Omit<LineProps, "why"> & {
  answer: Extract<BrowseAnswer, { rows: unknown }>;
  term: string;
  filtered: boolean;
  clearFilters: () => void;
  onAddByLink: (name?: string) => void;
  goTo: (page: number) => void;
}) {
  const { rows, total, exact, page, pageSize } = answer;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const close = total - exact;
  return (
    <>
      {/* Filtered counts stay exact, and say what they count (the directory size is the rounded-md one). */}
      <p role="status" className="tabular type-meta text-muted">
        {term
          ? [
              exact ? `${exact.toLocaleString()} exact ${exact === 1 ? "match" : "matches"} for “${term}”` : `No exact match for “${term}”`,
              close > 0 && `${close.toLocaleString()} close ${close === 1 ? "match" : "matches"}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : total === 0
            ? "No matching companies"
            : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} matching ${total === 1 ? "company" : "companies"}`}
      </p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {/* No company has the name typed: say so, and offer to add it by link under that name. */}
        {term && !exact && page === 1 && (
          <li className="space-y-2 px-3 py-4">
            <h3 className="type-body font-semibold">
              No company called “{term}” {filtered ? "with these filters" : "in the directory"}
            </h3>
            <p className="type-small text-muted">Paste its careers page link and RawJobs checks it right away.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => onAddByLink(typedName(term))}>
                <Link2 className="size-3.5" /> Add {typedName(term)} by link
              </Button>
              {filtered && (
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </li>
        )}
        {rows.map((g, i) => {
          const firstClose = !!term && g.rank > MATCH.exact && (i === 0 ? page === 1 : rows[i - 1]!.rank === MATCH.exact);
          return (
            <Fragment key={g.lead.key}>
              {firstClose && <li className="bg-inset px-3 py-1.5 type-label text-muted">Close matches</li>}
              <BrowseRow lead={g.lead} others={g.others} {...line} why={term ? matchWhy(g.rank, term) : undefined} />
            </Fragment>
          );
        })}
        {total === 0 && !term && (
          <li className="space-y-3 px-3 py-6 text-center type-small text-muted">
            <p>No company matches these filters.</p>
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </li>
        )}
      </ul>
      {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} onPage={goTo} />}
    </>
  );
}

/** Placeholder rows: 10, 6 on a phone. */
const SKELETON_ROWS = 10;
const SKELETON_ROWS_PHONE = 6;
/** Bar widths (rem) for the name and industry lines, varied so the placeholder reads as a list. */
const NAME_W = [9, 7, 11, 8, 10, 6];
const LINE_W = [6, 9, 5, 8, 7, 10];

/**
 * Browse all while results load: the count line, then rows drawn in the boxes a company row takes
 * (name, industry line, Add), so nothing moves when they arrive. Bars show after 100 ms and, with
 * reduced motion, don't shimmer. The first search after the app starts waits for the search index:
 * then the count line says so.
 */
export function BrowseSkeleton({ preparing }: { preparing?: boolean }) {
  return (
    <div className="space-y-3 animate-[rj-fade_var(--duration-quick)_var(--ease-enter)_100ms_backwards]" aria-busy="true" data-skeleton="browse">
      {preparing ? (
        <p role="status" className="flex h-[1.125rem] items-center gap-2 type-meta text-muted">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Getting search ready…
        </p>
      ) : (
        <p role="status" className="flex h-[1.125rem] items-center">
          <span className="sr-only">Loading companies</span>
          <span className="rj-skel h-2.5 w-56 max-w-full" aria-hidden />
        </p>
      )}
      <ul className="divide-y divide-line rounded-md border border-line" aria-hidden>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows, never reordered
          <li key={i} className={cx("flex items-center gap-3 px-3 py-2.5", i >= SKELETON_ROWS_PHONE && "max-sm:hidden")}>
            <div className="min-w-0 flex-1">
              <p className="flex h-5 items-center">
                <span className="rj-skel h-3 max-w-full" style={{ width: `${NAME_W[i % NAME_W.length]}rem` }} />
              </p>
              <p className="flex h-5 items-center">
                <span className="rj-skel h-2.5 max-w-full" style={{ width: `${LINE_W[i % LINE_W.length]}rem` }} />
              </p>
            </div>
            <span className="rj-skel h-7 w-[4.125rem] shrink-0 rounded-md pointer-coarse:h-11" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export type LineProps = {
  watched: Set<string>;
  /** How a search found this company ("name starts with “revolut”"). */
  why?: string;
  /** Your industries: a company's industry line names one of these first. */
  mine: readonly string[];
  onAdd: (c: DirCompany) => void;
  onRemove: (key: string) => void;
};

/** The id of the company's industry, one of yours when it's in several. */
function industryIdOf(c: Pick<DirCompany, "tags" | "title_tags">, mine: readonly string[]): string | undefined {
  const ids = [...(c.tags ?? []), ...(c.title_tags ?? [])].filter((id) => INDUSTRY_BY_ID.has(id));
  return ids.find((i) => mine.includes(i)) ?? ids[0];
}

/** The company's industry, one of yours when it's in several ("Payments"). */
export function industryOf(c: Pick<DirCompany, "tags" | "title_tags">, mine: readonly string[] = []): string | undefined {
  const id = industryIdOf(c, mine);
  return id ? INDUSTRY_BY_ID.get(id)!.label : undefined;
}

const SOURCE_HINT = { titles: "from its job titles", wikidata: "from Wikidata" } as const;

/**
 * The company's industry and, when no hand-made list says so, where it comes from:
 * ["Fintech (general)", "from its job titles"]. Directories from before `tag_src` mark only job-title
 * tags (title_tags). Empty without an industry.
 */
export function industryParts(c: Pick<DirCompany, "tags" | "title_tags" | "tag_src">, mine: readonly string[] = []): string[] {
  const id = industryIdOf(c, mine);
  if (!id) return [];
  const src = c.tag_src?.[id] ?? (c.title_tags?.includes(id) && !c.tags?.includes(id) ? "titles" : undefined);
  return [INDUSTRY_BY_ID.get(id)!.label, ...(src && src in SOURCE_HINT ? [SOURCE_HINT[src]] : [])];
}

/** One careers page: the company and what it is (industry), no job counts (those are on the Radar). */
function BoardLine({ c, watched, mine, onAdd, onRemove, sub, why }: LineProps & { c: DirCompany; sub?: boolean }) {
  const soon = !SUPPORTED.has(c.ats);
  const name = companyLabel(c);
  return (
    <div className={cx("flex items-center gap-3", sub && "pl-4")}>
      <div className="min-w-0 flex-1">
        <p className={cx("flex items-center gap-1.5 type-small", sub ? "text-muted" : "font-semibold")}>
          <span className="truncate">{sub ? `${name} on ${ATS_LABEL[c.ats] ?? c.ats}` : name}</span>
          <a href={safeUrl(c.careers_url)} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" aria-label={`${name} careers page`}>
            <ExternalLink className="size-3.5" />
          </a>
        </p>
        <p className="type-small text-muted">
          {[
            ...(sub ? [] : industryParts(c, mine)),
            !sub && why,
            c.status === "dormant" ? "not hiring right now" : c.status === "unverified" ? "not checked yet" : null,
            c.origin === "user" && "added by you",
            soon && "not supported yet",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <AddButton added={watched.has(c.key)} onAdd={() => onAdd(c)} onRemove={() => onRemove(c.key)} soon={soon} name={name} />
    </div>
  );
}

/** A company and, folded under it, its other live careers pages (or ones in My companies). */
export function BrowseRow({ lead, others, ...line }: LineProps & { lead: DirCompany; others: DirCompany[] }) {
  const [open, setOpen] = useState(() => others.some((o) => line.watched.has(o.key)));
  return (
    <li className="space-y-2 px-3 py-2.5">
      <BoardLine c={lead} {...line} />
      {others.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 type-label text-ink hover:text-muted">
          <ChevronDown className={cx("size-3.5 transition-transform", !open && "-rotate-90")} />
          {others.length} other careers page{others.length === 1 ? "" : "s"}
        </button>
      )}
      {open && others.map((o) => <BoardLine key={o.key} c={o} sub {...line} />)}
    </li>
  );
}
