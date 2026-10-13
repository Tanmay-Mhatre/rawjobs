import { companyLabel } from "@rawjobs/core/display-name";
import { INDUSTRIES, INDUSTRY_BY_ID, INDUSTRY_GROUPS } from "@rawjobs/core/catalog/industries";
import { isPlaceholderBoard, safeUrl } from "@rawjobs/core/text";
import { ChevronDown, CloudDownload, ExternalLink, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ATS_LABEL, groupBoards, SUPPORTED, type CompanyRef } from "../lib/companies";
import { companyIndex, companyMatches, MATCH, type CompanyIndex } from "../lib/companySearch";
import { canRunLocally } from "../lib/data";
import { DirectoryBar, updateDirectory } from "./DirectoryBar";
import { AddButton } from "./CompanyButtons";
import { Button, cx, Pagination, Select } from "./ui";

/** Directory entry served at data/catalog/directory.json (see scripts/catalog/publish.ts). */
export type DirCompany = CompanyRef & {
  key: string;
  tier: "curated" | "dump";
  /** unverified: a seed company on a hiring system RawJobs can't check yet. */
  status: "live" | "dormant" | "unverified";
  open_jobs: number | null;
  indexed: boolean;
  tags?: string[];
  title_tags?: string[];
  /** Where each tag that no hand-made list gives came from (directories from October 2026 on). */
  tag_src?: Record<string, "wikidata" | "titles">;
  /** Found by you with "Add by link", or from the industry seed list. */
  origin?: "user" | "seed";
};

const BROWSE_PAGE = 25;

type Props = {
  /** Keys of the companies in your list (saved or not yet). */
  watched: Set<string>;
  /** The directory, once loaded (shared with the rest of the page). */
  directory: DirCompany[] | null;
  directoryError: string | null;
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
  /** The directory's search index (companyIndex), shared with the page; built here when not given. */
  index?: CompanyIndex<DirCompany>;
};

/** Browse all: the whole directory, filtered by the header search, industry or hiring system. */
export function CompanyFinder({ watched, directory, directoryError, onAddMany, onRemove, onDirectoryUpdated, fit, industries, q, onAddByLink, companyCount, index }: Props) {
  return (
    <div className="space-y-4">
      <DirectoryBar onUpdated={onDirectoryUpdated} companies={companyCount} />
      <Browse
        all={directory}
        error={directoryError}
        fit={fit}
        mine={industries ?? []}
        watched={watched}
        onAdd={(c) => void onAddMany([c])}
        onRemove={onRemove}
        q={q}
        onAddByLink={onAddByLink}
        onReload={onDirectoryUpdated}
        index={index}
      />
    </div>
  );
}

// ---------- search the whole directory ----------

/**
 * Directory search, one row per company (its other careers pages fold under it), each with how it matched
 * (`rank`, MATCH). Browsing lists companies with open jobs; a search finds any, and yours always show. The
 * search looks at names only, never careers addresses (companyMatches): the exact name first, then names
 * that start with it, then names that contain it, then close spellings; within each, the best fit for your
 * profile, then the biggest. Sandbox and test boards never show (unless one is already in My companies).
 */
export function searchDirectory(
  all: readonly DirCompany[],
  o: {
    q: string;
    watched: ReadonlySet<string>;
    fit?: ReadonlyMap<string, number>;
    system?: "all" | "supported" | "soon";
    industry?: string;
    /** The directory's search index (companyIndex); built here when not given. */
    index?: CompanyIndex<DirCompany>;
  },
) {
  const s = o.q.trim().toLowerCase();
  const matches = s ? companyMatches(o.index ?? companyIndex(all), s) : undefined;
  const rank = (c: DirCompany) => matches?.get(c) ?? 0;
  const system = o.system ?? "all";
  const sorted = all
    .filter((c) => o.watched.has(c.key) || !isPlaceholderBoard(c.name))
    .filter((c) => c.status === "live" || !!s || o.watched.has(c.key))
    .filter((c) => system === "all" || (system === "supported") === SUPPORTED.has(c.ats))
    .filter((c) => !o.industry || !!c.tags?.includes(o.industry) || !!c.title_tags?.includes(o.industry))
    .filter((c) => !matches || matches.has(c))
    .sort((a, b) => rank(a) - rank(b) || (o.fit?.get(b.key) ?? 0) - (o.fit?.get(a.key) ?? 0) || (b.open_jobs ?? 0) - (a.open_jobs ?? 0));
  return groupBoards(sorted, new Set(o.watched)).map((g) => ({ ...g, rank: Math.min(rank(g.lead), ...g.others.map(rank)) }));
}

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

function Browse({
  all,
  error,
  fit,
  mine,
  watched,
  onAdd,
  onRemove,
  q,
  onAddByLink,
  onReload,
  index: shared,
}: {
  all: DirCompany[] | null;
  error: string | null;
  fit?: ReadonlyMap<string, number>;
  mine: string[];
  watched: Set<string>;
  onAdd: (c: DirCompany) => void;
  onRemove: (key: string) => void;
  q: string;
  onAddByLink: (name?: string) => void;
  onReload: () => void;
  index?: CompanyIndex<DirCompany>;
}) {
  const [system, setSystem] = useState<"all" | "supported" | "soon">("all");
  const [industry, setIndustry] = useState("");
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);

  const index = useMemo(() => shared ?? (all ? companyIndex(all) : undefined), [shared, all]);
  const results = useMemo(() => (all ? searchDirectory(all, { q, watched, fit, system, industry, index }) : []), [all, index, q, system, industry, watched, fit]);

  // Back to page 1 whenever the search or filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: back to page 1 whenever the search or a filter changes: they are the triggers
  useEffect(() => setPage(1), [q, system, industry]);
  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (error) return <DirectoryMissing onReload={onReload} />;
  if (!all)
    return (
      <p role="status" className="flex items-center gap-2 py-6 type-small text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Loading the directory…
      </p>
    );

  const pageItems = results.slice((page - 1) * BROWSE_PAGE, page * BROWSE_PAGE);
  const from = (page - 1) * BROWSE_PAGE + 1;
  const to = Math.min(results.length, page * BROWSE_PAGE);
  const term = q.trim();
  const exact = term ? results.filter((g) => g.rank === MATCH.exact).length : 0;
  const close = results.length - exact;
  const filtered = system !== "all" || !!industry;
  const clearFilters = () => {
    setSystem("all");
    setIndustry("");
  };

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
      {/* Filtered counts stay exact, and say what they count (the directory size is the rounded-md one). */}
      <p role="status" className="tabular type-meta text-muted">
        {term
          ? [
              exact ? `${exact.toLocaleString()} exact ${exact === 1 ? "match" : "matches"} for “${term}”` : `No exact match for “${term}”`,
              close > 0 && `${close.toLocaleString()} close ${close === 1 ? "match" : "matches"}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : results.length === 0
            ? "No matching companies"
            : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${results.length.toLocaleString()} matching ${results.length === 1 ? "company" : "companies"}`}
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
        {pageItems.map((g, i) => {
          const firstClose = !!term && g.rank > MATCH.exact && (i === 0 ? page === 1 : pageItems[i - 1]!.rank === MATCH.exact);
          return (
            <Fragment key={g.lead.key}>
              {firstClose && <li className="bg-inset px-3 py-1.5 type-label text-muted">Close matches</li>}
              <BrowseRow lead={g.lead} others={g.others} mine={mine} watched={watched} onAdd={onAdd} onRemove={onRemove} why={term ? matchWhy(g.rank, term) : undefined} />
            </Fragment>
          );
        })}
        {results.length === 0 && !term && (
          <li className="space-y-3 px-3 py-6 text-center type-small text-muted">
            <p>No company matches these filters.</p>
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </li>
        )}
      </ul>
      {results.length > BROWSE_PAGE && <Pagination page={page} pageSize={BROWSE_PAGE} total={results.length} onPage={goTo} />}
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

/** Load the directory (data/catalog/directory.json, plus companies added by link since the last publish). */
export function useDirectory(rev: number): { directory: DirCompany[] | null; error: string | null } {
  const [directory, setDirectory] = useState<DirCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rev` is the trigger: bumped to load the directory again
  useEffect(() => {
    const get = (path: string) => fetch(path, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ companies: DirCompany[] }>) : null));
    let live = true;
    setError(null);
    setDirectory(null);
    Promise.all([get("./catalog/directory.json"), get("./catalog/additions.json").catch(() => null)])
      .then(([dir, adds]) => {
        if (!dir) throw new Error("no directory");
        const known = new Set(dir.companies.map((c) => c.key));
        const extra = (adds?.companies ?? []).filter((c) => !known.has(c.key)).map((c): DirCompany => ({ ...c, tier: "dump", indexed: false, origin: "user" }));
        if (live) setDirectory([...dir.companies, ...extra]);
      })
      .catch(() => live && setError("The company directory isn't downloaded yet."));
    return () => {
      live = false;
    };
  }, [rev]);
  return { directory, error };
}
