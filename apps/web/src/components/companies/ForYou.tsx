import { companyLabel, displayName } from "@rawjobs/core/display-name";
import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { isPlaceholderBoard } from "@rawjobs/core/text";
import { Briefcase, History, Info, LoaderCircle, Package, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keyOf, type CompanyRef } from "../../lib/companies";
import { companyReasons, refOf, visible, type CompanySuggestion, type CompanySuggestions, type SuggestState } from "../../lib/companySuggest";
import { canRunLocally } from "../../lib/data";
import { load, save } from "../../lib/storage";
import { settingsHash } from "../settings/registry";
import { AddAll, AddButton } from "../CompanyButtons";
import { Chip } from "../primitives";
import { buttonClass } from "../primitives";
import { Button, Card, cx } from "../ui";
import { CardSkeleton, Monogram, SuggestionCard } from "./SuggestionCard";
import { TabList, TabPanel, useTabIds } from "./Tabs";

type Lens = "hiring" | "like" | "watching" | "packs" | "soon";

type Props = {
  state: SuggestState;
  /** Keys of companies in your list (saved or not). */
  watched: Set<string>;
  /** Keys you said "not interested" to. */
  muted: Set<string>;
  pastEmployers: string[];
  onPastEmployers: (names: string[]) => void;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
  onMute: (key: string) => void;
  onUnmute: (key: string) => void;
  /** Fewer cards, for the setup wizard. */
  compact?: boolean;
  /** Shown when there is nothing to suggest from (no roles yet). */
  offHint?: ReactNode;
  /** Ask for suggestions again after an error (shows a Retry button). */
  onRetry?: () => void;
  /** Industries in your profile. With none, the Starter packs lens stays and links to picking them. */
  industries?: number;
};

export const DISMISSED_KEY = "rawjobs.goBackDismissed";
/** "Off" for less than this right after mount or a change is just the request starting: keep the skeleton (M3). */
const OFF_GRACE_MS = 1000;
const PAGE = 9;

/** Suggestions to show: not in My companies or hidden, and never a sandbox or test board. */
const real = <T extends CompanySuggestion>(list: readonly T[], skip: ReadonlySet<string>) => visible(list, skip).filter((s) => !isPlaceholderBoard(s.name));

/**
 * Companies picked for you: hiring for your roles now, like the companies on your resume, worth
 * watching, one pack per industry, and ones RawJobs can't scan yet. Rule-based and local: nothing
 * about you leaves this computer.
 */
export function ForYou({ state, watched, muted, pastEmployers, onPastEmployers, onAddMany, onRemoveMany, onMute, onUnmute, compact, offHint, onRetry, industries }: Props) {
  const ids = useTabIds("suggest");
  // "Off" only counts once it has lasted a moment: the first render and profile changes pass through it.
  const [offSettled, setOffSettled] = useState(!canRunLocally);
  useEffect(() => {
    if (state.kind !== "off" || !canRunLocally) return setOffSettled(!canRunLocally);
    const t = setTimeout(() => setOffSettled(true), OFF_GRACE_MS);
    return () => clearTimeout(t);
  }, [state.kind]);
  const data = state.kind === "ready" ? state.data : state.kind === "loading" ? state.previous : undefined;
  const [lens, setLens] = useState<Lens | null>(null);
  const [shown, setShown] = useState(compact ? 6 : PAGE);
  const [hidden, setHidden] = useState<{ key: string; name: string } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => load<string[]>(DISMISSED_KEY, []));

  const lists = useMemo(() => {
    if (!data) return null;
    return {
      hiring: real(data.hiringNow, muted),
      watching: real(data.worthWatching, muted),
      soon: real(data.notScannable, muted),
      like: data.lookalikes.map((r) => ({ ...r, items: real(r.items, muted) })).filter((r) => r.items.length),
      packs: data.packs.map((p) => ({ ...p, items: real(p.items, muted) })).filter((p) => p.items.length),
    };
  }, [data, muted]);

  /** No industries, so no packs: the lens stays, saying how to get them. */
  const needIndustries = industries === 0 && !lists?.packs.length;
  // Open on packs (the quickest way to add many; at 0 companies also when they need industries), else the most useful list.
  const current: Lens = lens ?? (lists?.packs.length || (needIndustries && watched.size === 0) ? "packs" : lists && lists.hiring.length < 3 ? (lists.like.length ? "like" : "watching") : "hiring");
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching lists starts the new one at its first page
  useEffect(() => setShown(compact ? 6 : PAGE), [current, compact]);

  const hide = (s: CompanySuggestion) => {
    onMute(s.key);
    setHidden({ key: s.key, name: s.name });
  };
  const card = (s: CompanySuggestion) => (
    <SuggestionCard key={s.key} s={s} added={watched.has(s.key) || watched.has(keyOf(s))} onAdd={() => void onAddMany([refOf(s)])} onRemove={() => onRemoveMany([s.key])} onHide={() => hide(s)} />
  );
  const grid = (items: CompanySuggestion[], limit = shown, more = () => setShown((n) => n + PAGE)) => (
    <>
      <div className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>{items.slice(0, limit).map(card)}</div>
      {items.length > limit && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={more}>
            Show more ({items.length - limit})
          </Button>
        </div>
      )}
    </>
  );

  type Tab = { id: Lens; label: string; count?: number };
  const tabs: Tab[] = lists
    ? (
        [
          { id: "packs", label: "Starter packs", count: lists.packs.length },
          { id: "hiring", label: "Hiring for you now", count: lists.hiring.length },
          { id: "like", label: "Like your past employers", count: lists.like.reduce((n, r) => n + r.items.length, 0) },
          { id: "watching", label: "Not hiring yet", count: lists.watching.length },
          { id: "soon", label: "Not supported yet", count: lists.soon.length },
        ] satisfies Tab[]
      )
        .filter((t) => t.count || t.id === "hiring" || t.id === "like" || t.id === current || (t.id === "packs" && needIndustries))
        // No "0" on a lens: an empty one says why when opened.
        .map((t) => ({ ...t, count: t.count || undefined }))
    : [];

  const goBack = (data?.pastEmployers ?? []).filter((p) => p.company && !dismissed.includes(p.company.key) && !muted.has(p.company.key) && !isPlaceholderBoard(p.company.name));

  const Wrap = compact ? "div" : Card;
  const top5 = lists ? [...lists.hiring, ...lists.like.flatMap((r) => r.items)].filter((s, i, all) => all.findIndex((x) => x.key === s.key) === i).slice(0, 5) : [];
  return (
    <Wrap className={compact ? "" : "p-5 sm:p-6"}>
      {/* The Suggestions tab names this panel. */}
      <h2 className="sr-only">Suggestions</h2>
      <PastEmployers names={pastEmployers} suggested={data?.pastEmployers.map((p) => p.name)} onChange={onPastEmployers} />
      {compact && top5.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-inset p-3 type-small">
          <span className="mr-auto">
            Quick start: add the {top5.length} best fits ({top5.map(companyLabel).join(", ")}).
          </span>
          <AddAll items={top5.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
        </div>
      )}

      {state.kind === "off" && offSettled ? (
        <p className="mt-4 rounded-md border border-dashed border-line p-4 type-small text-muted">
          {!canRunLocally && offHint
            ? offHint
            : canRunLocally
              ? "Pick the roles you want first to see companies hiring for them."
              : "Suggestions aren't available in this version of the app. Search the directory or add a company by link instead."}
        </p>
      ) : state.kind === "error" ? (
        <div role="alert" className="mt-4 space-y-2 rounded-md bg-warning-subtle/50 p-4 type-small">
          <p className="font-medium">Suggestions aren't available right now.</p>
          <div className="flex flex-wrap items-center gap-3">
            {onRetry ? (
              <Button size="sm" onClick={onRetry}>
                <RefreshCw className="size-3.5" /> Try again
              </Button>
            ) : (
              <span className="text-muted">Try again in a moment.</span>
            )}
          </div>
          <details className="type-meta text-muted">
            <summary className="cursor-pointer">Technical details</summary>
            {state.message}
          </details>
        </div>
      ) : !lists ? (
        <div className="mt-4 space-y-3">
          <p role="status" className="flex items-center gap-2 type-small text-muted">
            <LoaderCircle className="size-4 animate-spin" /> Matching thousands of companies to your profile… (the first time takes about 10 seconds)
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: compact ? 2 : 3 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : (
        <div className={cx("mt-4 space-y-4", state.kind === "loading" && "opacity-60 transition-opacity")} aria-busy={state.kind === "loading"}>
          <TabList
            tabs={tabs}
            value={current}
            onChange={setLens}
            label="Kinds of suggestions"
            wrap
            ids={ids}
            after={state.kind === "loading" && <LoaderCircle className="ml-1 size-4 shrink-0 animate-spin text-muted" aria-label="Updating suggestions" />}
          />

          <TabPanel id={current} ids={ids} className="space-y-4">
            {current === "packs" && needIndustries ? <NeedIndustries /> : <LensHeader lens={current} lists={lists} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />}

            {hidden && muted.has(hidden.key) && (
              <p className="flex items-center gap-2 rounded-md bg-inset px-3 py-2 type-small">
                <span className="mr-auto">
                  Hid <b>{displayName(hidden.name)}</b>. Its jobs won't show either.
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 type-label text-ink underline underline-offset-2 hover:text-muted"
                  onClick={() => {
                    onUnmute(hidden.key);
                    setHidden(null);
                  }}
                >
                  <Undo2 className="size-3.5" /> Undo
                </button>
              </p>
            )}

            {current === "hiring" &&
              (lists.hiring.length ? grid(lists.hiring) : <Empty>No company has an opening that passes your filters today. Try the Not hiring yet list, or widen your places.</Empty>)}
            {current === "watching" && grid(lists.watching)}
            {current === "soon" && grid(lists.soon)}
            {current === "like" && (
              <LikeLens
                rows={lists.like}
                goBack={goBack}
                hasEmployers={pastEmployers.length > 0 || !!data?.pastEmployers.length}
                grid={grid}
                compact={compact}
                watched={watched}
                onAddMany={onAddMany}
                onRemoveMany={onRemoveMany}
                onDismiss={(key) => {
                  const next = [...dismissed, key];
                  setDismissed(next);
                  save(DISMISSED_KEY, next);
                }}
              />
            )}
            {current === "packs" && !needIndustries && <Packs packs={lists.packs} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />}
          </TabPanel>
        </div>
      )}
      {!compact && canRunLocally && (
        <p className="mt-5 flex items-center gap-1.5 type-meta text-muted">
          <Info className="size-3.5 shrink-0" aria-hidden /> Suggestions are worked out on this computer. Nothing about you is sent anywhere.
        </p>
      )}
    </Wrap>
  );
}

const unique = (items: CompanySuggestion[]) => items.filter((s, i) => items.findIndex((x) => x.key === s.key) === i);

/** No industries in your profile, so no starter packs: say so and link to picking them. */
function NeedIndustries() {
  return (
    <div className="grid justify-items-start gap-2 rounded-md border border-dashed border-line p-4 type-small">
      <p className="font-semibold">Starter packs need industries</p>
      <p className="text-muted">Pick the industries you'd work in to get a pack of companies for each, ready to add in one click.</p>
      <a href={`#${settingsHash("industries")}`} className={buttonClass("secondary", "sm")}>
        Pick industries
      </a>
    </div>
  );
}

/** "Add all" for everything in the lens (not just the cards on screen); on Starter packs, how many packs. */
function LensHeader({
  lens,
  lists,
  watched,
  onAddMany,
  onRemoveMany,
}: {
  lens: Lens;
  lists: { hiring: CompanySuggestion[]; watching: CompanySuggestion[]; soon: CompanySuggestion[]; like: { items: CompanySuggestion[] }[]; packs: { items: CompanySuggestion[] }[] };
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
}) {
  const items =
    lens === "packs"
      ? unique(lists.packs.flatMap((p) => p.items))
      : lens === "like"
        ? unique(lists.like.flatMap((r) => r.items))
        : lens === "hiring"
          ? lists.hiring
          : lens === "watching"
            ? lists.watching
            : lists.soon;
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {lens === "packs" && (
        <p className="min-w-0 flex-1 type-small text-muted">
          {lists.packs.length} {lists.packs.length === 1 ? "pack" : "packs"} from your industries
        </p>
      )}
      {/* Keyed by lens, so its "Added n · Undo" belongs to this list only. Orange only as the way to start, at 0 companies. */}
      <AddAll key={lens} items={items.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} primary={lens === "packs" && watched.size === 0} />
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line p-4 type-small text-muted">{children}</p>;
}

function LikeLens({
  rows,
  goBack,
  hasEmployers,
  grid,
  compact,
  watched,
  onAddMany,
  onRemoveMany,
  onDismiss,
}: {
  rows: { seed: string; in_directory: boolean; items: CompanySuggestion[] }[];
  goBack: CompanySuggestions["pastEmployers"];
  hasEmployers: boolean;
  grid: (items: CompanySuggestion[], limit?: number, more?: () => void) => ReactNode;
  compact?: boolean;
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState<string[]>([]);
  if (!hasEmployers) return <Empty>Add the companies you've worked at above to see companies like them that are hiring for you.</Empty>;
  return (
    <div className="space-y-5">
      {rows.length === 0 && <Empty>No close match yet for your past employers among companies that fit your roles and places.</Empty>}
      {rows.map((r) => (
        <section key={r.seed} className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="min-w-0 flex-1 type-small font-semibold">
              Because you worked at {r.seed}
              {!r.in_directory && <span className="ml-2 type-small font-normal text-muted">(matched on the industries in that role on your resume)</span>}
            </h3>
            <AddAll items={r.items.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
          </div>
          {grid(r.items, open.includes(r.seed) ? r.items.length : compact ? 2 : 3, () => setOpen((o) => [...o, r.seed]))}
        </section>
      ))}
      {goBack.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 type-small font-semibold">
            <History className="size-4 text-muted" /> Go back?
          </h3>
          <p className="type-small text-muted">Your past employers that RawJobs can scan. Some people like to keep an eye on them.</p>
          <ul className="flex flex-wrap gap-2">
            {goBack.map(({ company: c }) => (
              <li key={c!.key} className="flex items-center gap-2 rounded-md border border-line py-1.5 pl-2 pr-1.5">
                <Monogram name={companyLabel(c!)} size="sm" />
                <span className="type-label">{companyLabel(c!)}</span>
                <AddButton added={watched.has(c!.key)} onAdd={() => void onAddMany([c!])} onRemove={() => onRemoveMany([c!.key])} name={companyLabel(c!)} />
                <button
                  type="button"
                  aria-label={`Don't suggest ${companyLabel(c!)}`}
                  title="Don't suggest"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink"
                  onClick={() => onDismiss(c!.key)}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Packs({
  packs,
  watched,
  onAddMany,
  onRemoveMany,
}: {
  packs: { industry: string; items: CompanySuggestion[] }[];
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packs.map((p) => (
        <section key={p.industry} className="flex min-w-0 flex-col gap-3 rounded-md border border-line p-4">
          <header className="flex items-center gap-2">
            <Package className="size-4 text-muted" aria-hidden />
            <h3 className="mr-auto type-small font-semibold">{INDUSTRY_BY_ID.get(p.industry)?.label ?? p.industry}</h3>
            <AddAll items={p.items.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
          </header>
          <ul className="flex flex-wrap gap-1.5">
            {p.items.map((s) => {
              const on = watched.has(s.key);
              return (
                <li key={s.key}>
                  <Chip pressed={on} onClick={() => (on ? onRemoveMany([s.key]) : onAddMany([refOf(s)]))} title={companyReasons(s.reasons).join(" · ")} className="pl-1.5">
                    <Monogram name={companyLabel(s)} size="xs" />
                    {companyLabel(s)}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The companies on your resume, as editable chips. They seed "companies like them". */
export function PastEmployers({ names, suggested = [], onChange }: { names: string[]; suggested?: string[]; onChange: (names: string[]) => void }) {
  const [text, setText] = useState("");
  if (!names.length && suggested.length) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-line p-2.5">
        <span className="mr-1 inline-flex items-center gap-1.5 type-label text-muted">
          <Briefcase className="size-4" aria-hidden /> From your resume, you've worked at
        </span>
        <span className="type-small text-ink">{suggested.join(", ")}</span>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => onChange(suggested)}>
          Looks right
        </Button>
      </div>
    );
  }
  const add = () => {
    const n = text.trim().replace(/\s+/g, " ");
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) onChange([...names, n]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1.5 type-label text-muted">
        <Briefcase className="size-4" aria-hidden /> You've worked at
      </span>
      {names.map((n) => (
        <span key={n} className="rj-chip cursor-default gap-1 pr-1">
          {n}
          <button
            type="button"
            aria-label={`Remove ${n}`}
            title={`Remove ${n}`}
            className="inline-flex size-6 items-center justify-center rounded-md hover:bg-inset hover:text-ink"
            onClick={() => onChange(names.filter((x) => x !== n))}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <form
        className="inline-flex items-center"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={names.length ? "Add another" : "Past employer…"}
          aria-label="Add a past employer"
          className="h-7 w-44 rounded-md border border-dashed border-line bg-transparent px-2 type-small placeholder:text-muted"
        />
        {text.trim() && (
          <button type="submit" aria-label={`Add ${text.trim()} as a past employer`} className="ml-1 inline-flex size-7 items-center justify-center rounded-md text-ink hover:bg-hover">
            <Plus className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
