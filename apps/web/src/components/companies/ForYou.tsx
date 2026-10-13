import { companyLabel, displayName } from "@rawjobs/core/display-name";
import { isPlaceholderBoard } from "@rawjobs/core/text";
import { Briefcase, Check, ChevronRight, CircleCheck, History, Info, LoaderCircle, Package, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { keyOf, type CompanyRef } from "../../lib/companies";
import { companyReasons, groupSuggestions, refOf, type SuggestionGroup, visible, type CompanySuggestion, type CompanySuggestions, type SuggestState } from "../../lib/companySuggest";
import { canRunLocally } from "../../lib/data";
import { clearFresh, isAdded, type NextUp, packMembers, packState, revealNext, uniqueMembers } from "../../lib/packVisit";
import { load, save } from "../../lib/storage";
import { settingsHash } from "../settings/registry";
import { AddAll, AddButton } from "../CompanyButtons";
import { buttonClass, Chip } from "../primitives";
import { Button, Card, cx } from "../ui";
import { Monogram, SuggestionCard } from "./SuggestionCard";
import { type Lens, MatchingStatus, openingLens, SuggestSkeleton } from "./SuggestSkeleton";
import { TabList, TabPanel, useTabIds } from "./Tabs";
import { packLabel, type PackActions } from "./Tray";

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
  /** Opens your hidden companies (My companies, Hidden panel): the link after hiding a suggestion. */
  onShowHidden?: () => void;
  /** Fewer cards, for the setup wizard. */
  compact?: boolean;
  /** Shown when there is nothing to suggest from (no roles yet). */
  offHint?: ReactNode;
  /** Ask for suggestions again after an error (shows a Retry button). */
  onRetry?: () => void;
  /** Industries in your profile. With none, the Starter packs lens stays and links to picking them. */
  industries?: number;
  /** How Starter packs add and remove (the Companies page's tray records them); else straight to the list. */
  packActions?: PackActions;
  /** How many companies a match checks, for the loading line; left out while unknown. */
  poolSize?: number | null;
  /** Opens My companies: the next step once a lens is all added. */
  onSeeMine?: () => void;
  /** Opens Browse all: the next step once Not hiring yet is all added. */
  onBrowse?: () => void;
};

export const DISMISSED_KEY = "rawjobs.goBackDismissed";
/** "Off" for less than this right after mount or a change is just the request starting: keep the skeleton (M3). */
const OFF_GRACE_MS = 1000;
const PAGE = 9;
/** "Add top 10": the bulk add in Hiring for you now and Not hiring yet, in your industries only. */
const TOP = 10;
/** After Add all, the same button turns into See My companies: presses this soon after are the same double press. */
export const DOUBLE_PRESS_MS = 300;
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

type Pack = { industry: string; items: CompanySuggestion[]; more: CompanySuggestion[] };
/** A pack with nothing left to suggest: its companies (keys) are all in My companies. */
type Finished = { industry: string; keys: string[] };
/** Screen readers hear this where a lens that's all added shows a check in place of its count. */
const ALL_IN = "all in My companies";

/** Suggestions to show: not in My companies or hidden, and never a sandbox or test board. */
const real = <T extends CompanySuggestion>(list: readonly T[], skip: ReadonlySet<string>) => visible(list, skip).filter((s) => !isPlaceholderBoard(s.name));

/**
 * Companies picked for you: hiring for your roles now, like the companies on your resume, worth
 * watching, one pack per industry, and ones RawJobs can't scan yet. Rule-based and local: nothing
 * about you leaves this computer.
 */
export function ForYou({
  state,
  watched,
  muted,
  pastEmployers,
  onPastEmployers,
  onAddMany,
  onRemoveMany,
  onMute,
  onUnmute,
  onShowHidden,
  compact,
  offHint,
  onRetry,
  industries,
  packActions,
  poolSize,
  onSeeMine,
  onBrowse,
}: Props) {
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
  const packs: PackActions = packActions ?? { add: (refs) => void onAddMany(refs), remove: (keys) => onRemoveMany(keys) };
  const [nextUp, setNextUp] = useState<NextUp>({});

  const lists = useMemo(() => {
    if (!data) return null;
    const packs = data.packs.map((p): Pack => ({ industry: p.industry, items: real(p.items, muted), more: real(p.more ?? [], muted) })).filter((p) => p.items.length);
    // What the answer left out because it's in My companies (older answers don't say).
    const added = data.added;
    const finished = Object.entries(added?.packs ?? {})
      .filter(([industry, keys]) => keys.length && !packs.some((p) => p.industry === industry))
      .map(([industry, keys]): Finished => ({ industry, keys }));
    return {
      hiring: real(data.hiringNow, muted),
      watching: real(data.worthWatching, muted),
      soon: real(data.notScannable, muted),
      like: data.lookalikes.map((r) => ({ ...r, items: real(r.items, muted) })).filter((r) => r.items.length),
      packs,
      finished,
      added: {
        hiring: added?.hiring ?? 0,
        watching: added?.watching ?? 0,
        soon: added?.soon ?? 0,
        likeOf: Object.entries(added?.like ?? {})
          .filter(([, n]) => n > 0)
          .map(([seed]) => seed),
      },
    };
  }, [data, muted]);
  // Finished packs while their companies are still yours (Remove pack takes the card away; the tray can undo it).
  const finished = (lists?.finished ?? []).map((f) => ({ ...f, keys: f.keys.filter((k) => watched.has(k)) })).filter((f) => f.keys.length);
  /** A lens with nothing left to suggest because you've added all of it: it says so, rather than "nothing found". */
  const allIn: Record<Lens, boolean> | null = lists
    ? {
        packs: !lists.packs.length && finished.length > 0,
        hiring: !lists.hiring.length && lists.added.hiring > 0,
        like: !lists.like.length && lists.added.likeOf.length > 0,
        watching: !lists.watching.length && lists.added.watching > 0,
        soon: !lists.soon.length && lists.added.soon > 0,
      }
    : null;

  /** No industries, so no packs: the lens stays, saying how to get them. */
  const needIndustries = industries === 0 && !lists?.packs.length && !finished.length;
  // Open on packs (the quickest way to add many, or where you finished them; at 0 companies also when
  // they need industries), else the most useful list.
  const current: Lens =
    lens ?? (lists?.packs.length || finished.length || (needIndustries && watched.size === 0) ? "packs" : lists && lists.hiring.length < 3 ? (lists.like.length ? "like" : "watching") : "hiring");
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching lists starts the new one at its first page
  useEffect(() => setShown(compact ? 6 : PAGE), [current, compact]);

  const hide = (s: CompanySuggestion) => {
    onMute(s.key);
    setHidden({ key: s.key, name: s.name });
  };
  const card = (s: CompanySuggestion, opts: { note?: string } = {}) => (
    <SuggestionCard
      key={s.key}
      s={s}
      added={isAdded(watched, s)}
      onAdd={() => void onAddMany([refOf(s)])}
      onRemove={() => onRemoveMany([s.key, keyOf(s)])}
      onHide={() => hide(s)}
      note={opts.note}
      addedText={current === "watching" ? "Watching" : undefined}
    />
  );
  const cards = (items: CompanySuggestion[], note?: (s: CompanySuggestion) => string | undefined) => (
    <div className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>{items.map((s) => card(s, { note: note?.(s) }))}</div>
  );

  type Tab = { id: Lens; label: string; count?: number; done?: string };
  const tabs: Tab[] =
    lists && allIn
      ? (
          [
            { id: "packs", label: "Starter packs", count: lists.packs.length + finished.length },
            { id: "hiring", label: "Hiring for you now", count: lists.hiring.length },
            { id: "like", label: "Like your past employers", count: lists.like.reduce((n, r) => n + r.items.length, 0) },
            { id: "watching", label: "Not hiring yet", count: lists.watching.length },
            { id: "soon", label: "Not supported yet", count: lists.soon.length },
          ] satisfies Tab[]
        )
          // A lens you've added all of stays, with a check in place of its count.
          .map((t) => ({ ...t, done: allIn[t.id] ? ALL_IN : undefined }))
          .filter((t) => t.count || t.done || t.id === "hiring" || t.id === "like" || t.id === current || (t.id === "packs" && needIndustries))
          // No "0" on a lens: an empty one says why when opened.
          .map((t) => ({ ...t, count: t.count || undefined }))
      : [];
  /** "Try Hiring for you now": the next lens that has something to add. */
  const tryNext = (from: Lens) => {
    if (!lists) return null;
    const order: [Lens, string, number][] = [
      ["hiring", "Hiring for you now", lists.hiring.length],
      ["like", "Like your past employers", lists.like.length],
      ["watching", "Not hiring yet", lists.watching.length],
      ["packs", "Starter packs", lists.packs.length],
    ];
    const next = order.find(([id, , n]) => id !== from && n > 0);
    return next ? (
      <Button key="try" size="sm" variant="ghost" onClick={() => setLens(next[0])}>
        Try {next[1]}
      </Button>
    ) : null;
  };
  const seeMine = onSeeMine && (
    <Button key="mine" size="sm" onClick={onSeeMine}>
      See My companies
    </Button>
  );

  const goBack = (data?.pastEmployers ?? []).filter((p) => p.company && !dismissed.includes(p.company.key) && !muted.has(p.company.key) && !isPlaceholderBoard(p.company.name));

  // Packs as shown (each with the extras revealed so far); a pack change other than a pick drops the "new" marks.
  const shownPacks = (lists?.packs ?? []).map((p) => ({ ...p, items: packMembers(p, nextUp) }));
  const packActs: PackActions = {
    add: (refs, text, packOf) => {
      setNextUp(clearFresh);
      packs.add(refs, text, packOf);
    },
    remove: (keys, text) => {
      setNextUp(clearFresh);
      packs.remove(keys, text);
    },
  };
  /** One company picked in a pack: add it, then the next 2 from that pack join its end. */
  const pick = (industry: string, s: CompanySuggestion) => {
    const p = lists?.packs.find((x) => x.industry === industry);
    packs.add(
      [refOf(s)],
      () => `Added ${companyLabel(s)}`,
      () => industry,
    );
    if (p) setNextUp((st) => revealNext(st, p, companyLabel(s), watched));
  };

  const Wrap = compact ? "div" : Card;
  // In the card, the tabs sit right under its top padding (no gap above them); in the setup wizard the
  // panel follows other content, so it keeps its own space.
  const top = compact ? "mt-4" : undefined;
  const top5 = lists ? [...lists.hiring, ...lists.like.flatMap((r) => r.items)].filter((s, i, all) => all.findIndex((x) => x.key === s.key) === i).slice(0, 5) : [];
  return (
    <Wrap className={compact ? "" : "p-5 sm:p-6"}>
      {/* The Suggestions tab names this panel. */}
      <h2 className="sr-only">Suggestions</h2>
      {compact && top5.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-inset p-3 type-small">
          <span className="mr-auto">
            Quick start: add the {top5.length} best fits ({top5.map(companyLabel).join(", ")}).
          </span>
          <AddAll items={top5.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
        </div>
      )}

      {state.kind === "off" && offSettled ? (
        <p className={cx(top, "rounded-md border border-dashed border-line p-4 type-small text-muted")}>
          {!canRunLocally && offHint
            ? offHint
            : canRunLocally
              ? "Pick the roles you want first to see companies hiring for them."
              : "Suggestions aren't available in this version of the app. Search the directory or add a company by link instead."}
        </p>
      ) : state.kind === "error" ? (
        <div role="alert" className={cx(top, "space-y-2 rounded-md bg-warning-subtle/50 p-4 type-small")}>
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
        <SuggestSkeleton
          lens={lens ?? openingLens(industries, watched.size)}
          industries={industries}
          compact={compact}
          status={<MatchingStatus companies={poolSize} />}
          needIndustries={industries === 0 && (lens ?? "packs") === "packs" && <NeedIndustries />}
        />
      ) : (
        // A new answer on its way: the one on screen stays readable and usable until it's replaced in place.
        <div className={cx(top, "space-y-4")} aria-busy={state.kind === "loading"}>
          <TabList
            tabs={tabs}
            value={current}
            onChange={setLens}
            label="Kinds of suggestions"
            wrap
            ids={ids}
            after={
              <span role="status" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap type-meta text-muted">
                {state.kind === "loading" && (
                  <>
                    <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
                    {/* On a phone the spinner alone, so the tabs keep their lines; screen readers hear the words. */}
                    <span className="max-sm:sr-only">Updating suggestions</span>
                  </>
                )}
              </span>
            }
          />

          <TabPanel id={current} ids={ids} className="space-y-4">
            {current === "packs" ? (
              needIndustries ? (
                <NeedIndustries />
              ) : allIn?.packs ? (
                <>
                  <AllAdded title="Every starter pack is in My companies" actions={[seeMine, tryNext("packs")]}>
                    {packsDone(finished)} New companies in your industries show up here when the directory updates.
                  </AllAdded>
                  {/* Folded, as a way to Remove pack without the cards repeating what the block says. */}
                  <FinishedPacks finished={finished} actions={packActs} />
                </>
              ) : (
                <PacksHeader packs={shownPacks} finished={finished} watched={watched} actions={packActs} onSeeMine={onSeeMine} />
              )
            ) : current === "soon" ? (
              allIn?.soon ? (
                <AllAdded
                  title={lists.added.soon === 1 ? "The not-yet-supported company is in My companies" : `All ${lists.added.soon} not-yet-supported companies are in My companies`}
                  actions={[seeMine]}
                >
                  {lists.added.soon === 1 ? "RawJobs starts checking it once its job site is supported." : "RawJobs starts checking them once their job sites are supported."}
                </AllAdded>
              ) : (
                <LensHeader items={lists.soon} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
              )
            ) : current === "like" ? (
              <PastEmployers names={pastEmployers} suggested={data?.pastEmployers.map((p) => p.name)} onChange={onPastEmployers} />
            ) : null}

            {hidden && muted.has(hidden.key) && (
              <p className="flex items-center gap-2 rounded-md bg-inset px-3 py-2 type-small">
                <span className="mr-auto">
                  Hid <b>{displayName(hidden.name)}</b>. It won't be suggested, and its jobs won't show on your Radar.
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
                {onShowHidden && (
                  <button type="button" className="type-label text-ink underline underline-offset-2 hover:text-muted" onClick={onShowHidden}>
                    See hidden companies
                  </button>
                )}
              </p>
            )}

            {current === "hiring" &&
              (lists.hiring.length ? (
                <Grouped
                  lens="hiring"
                  items={lists.hiring}
                  industries={industries}
                  asOf={data?.index_generated_at}
                  watched={watched}
                  onAddMany={onAddMany}
                  onRemoveMany={onRemoveMany}
                  cards={cards}
                  shown={shown}
                  onMore={() => setShown((n) => n + PAGE)}
                />
              ) : allIn?.hiring ? (
                <AllAdded title="Every company hiring for you is in My companies" actions={[seeMine, tryNext("hiring")]}>
                  {inYourList(lists.added.hiring)} New matches show up here when the directory updates.
                </AllAdded>
              ) : (
                <Empty
                  title="No company is hiring for you today"
                  actions={[
                    <a key="places" href={`#${settingsHash("locations")}`} className={buttonClass("secondary", "sm")}>
                      Widen your places
                    </a>,
                    tryNext("hiring"),
                  ]}
                >
                  {data?.scanned ? `None of the ${data.scanned.toLocaleString()} companies has` : "No company has"} an opening that passes your title and place filters.
                </Empty>
              ))}
            {current === "watching" && allIn?.watching && (
              <AllAdded
                title="Every company worth watching is in My companies"
                actions={[
                  seeMine,
                  onBrowse && (
                    <Button key="browse" size="sm" variant="ghost" onClick={onBrowse}>
                      Browse all companies
                    </Button>
                  ),
                ]}
              >
                {inYourList(lists.added.watching)} New ones show up here when the directory updates.
              </AllAdded>
            )}
            {current === "watching" && !allIn?.watching && (
              <Grouped
                lens="watching"
                items={lists.watching}
                industries={industries}
                watched={watched}
                onAddMany={onAddMany}
                onRemoveMany={onRemoveMany}
                cards={cards}
                shown={shown}
                onMore={() => setShown((n) => n + PAGE)}
              />
            )}
            {current === "soon" && <GroupList groups={groupSuggestions(lists.soon.slice(0, shown), "watching")} cards={cards} />}
            {current === "soon" && lists.soon.length > shown && <ShowMore onClick={() => setShown((n) => n + PAGE)}>Show {lists.soon.length - shown} more</ShowMore>}
            {current === "like" && (
              <LikeLens
                rows={lists.like}
                goBack={goBack}
                hasEmployers={pastEmployers.length > 0 || !!data?.pastEmployers.length}
                allAdded={
                  allIn?.like && (
                    <AllAdded title={`Every company like ${andList(lists.added.likeOf)} is in My companies`} actions={[seeMine]}>
                      Add another past employer above to see companies like it.
                    </AllAdded>
                  )
                }
                cards={cards}
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
            {current === "packs" && !needIndustries && !allIn?.packs && <Packs packs={shownPacks} finished={finished} nextUp={nextUp} watched={watched} actions={packActs} onPick={pick} />}
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

/** "Add all" for everything in the lens (not just the cards on screen). */
function LensHeader({
  items,
  watched,
  onAddMany,
  onRemoveMany,
}: {
  items: CompanySuggestion[];
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <AddAll items={items.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
    </div>
  );
}

function ShowMore({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-center">
      <Button variant="ghost" onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}

/** Cards under one header per shared reason: "Crypto & Web3 14 · Your industry, and your topics crypto and web3". */
function GroupList({ groups, counts, cards }: { groups: SuggestionGroup[]; counts?: Map<string, number>; cards: (items: CompanySuggestion[]) => ReactNode }) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <GroupSection key={g.id} title={g.title} reason={g.reason} count={counts?.get(g.id) ?? g.items.length}>
          {cards(g.items)}
        </GroupSection>
      ))}
    </div>
  );
}

function GroupSection({ title, reason, count, children }: { title: string; reason: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <h3 id={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 type-small font-semibold">
        <span>
          {title} <span className="tabular font-normal text-muted">{count}</span>
        </span>
        {reason && <span className="type-meta font-normal text-muted">{reason}</span>}
      </h3>
      {children}
    </section>
  );
}

/** "Oct 7", kept on one line. */
const shortDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).replace(/\s/g, " ") : null;
};

/**
 * Hiring for you now and Not hiring yet: the companies in your industries, grouped by the reason they
 * share, with "Add top 10" for them; the ones outside your industries fold away below and aren't in
 * the bulk add. Without industries in your profile there's nothing to split, so all show.
 */
function Grouped({
  lens,
  items,
  industries,
  asOf,
  watched,
  onAddMany,
  onRemoveMany,
  cards,
  shown,
  onMore,
}: {
  lens: "hiring" | "watching";
  items: CompanySuggestion[];
  industries?: number;
  asOf?: string;
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
  cards: (items: CompanySuggestion[]) => ReactNode;
  shown: number;
  onMore: () => void;
}) {
  const split = industries !== 0 && items.some((s) => s.industries.length);
  const inside = split ? items.filter((s) => s.industries.length) : items;
  const outside = split ? items.filter((s) => !s.industries.length) : [];
  const counts = new Map(groupSuggestions(inside, lens).map((g) => [g.id, g.items.length]));
  const top = inside.filter((s) => !isAdded(watched, s)).slice(0, TOP);
  const date = shortDate(asOf);
  const intro = lens === "watching" ? "Nothing open for you yet. Add them to hear first." : `${split ? "In your industries" : "Companies hiring for you"}${date ? `, as of ${date}` : ""}`;
  const left = inside.length - shown;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 type-small text-muted">{intro}</p>
        {/* Keyed by lens, so its "Added n · Undo" belongs to this list only. */}
        <AddAll
          key={lens}
          items={top.map(refOf)}
          watched={watched}
          onAddMany={onAddMany}
          onRemoveMany={onRemoveMany}
          primary={watched.size === 0}
          label={(n) => (n >= TOP ? `Add top ${TOP}` : `Add all ${n}`)}
          done={inside.length > 0 && <AllInMine n={inside.length} />}
        />
      </div>
      <GroupList groups={groupSuggestions(inside.slice(0, shown), lens)} counts={counts} cards={cards} />
      {left > 0 && (
        <ShowMore onClick={onMore}>
          Show {left} more{split ? " in your industries" : ""}
        </ShowMore>
      )}
      {outside.length > 0 && <Outside items={outside} lens={lens} cards={cards} />}
    </>
  );
}

/** Companies outside your industries, folded: they fit, but you didn't pick their industry. */
function Outside({ items, lens, cards }: { items: CompanySuggestion[]; lens: "hiring" | "watching"; cards: (items: CompanySuggestion[]) => ReactNode }) {
  const [shown, setShown] = useState(PAGE);
  const counts = new Map(groupSuggestions(items, lens).map((g) => [g.id, g.items.length]));
  return (
    <details className="group/fold space-y-3 border-t border-hairline pt-4">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 type-label [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform duration-150 group-open/fold:rotate-90" aria-hidden />
        Outside your industries <span className="tabular font-normal text-muted">{items.length}</span>
      </summary>
      <p className="type-small text-muted">Not in an industry you picked, so Add top {TOP} leaves them out.</p>
      <GroupList groups={groupSuggestions(items.slice(0, shown), lens)} counts={counts} cards={cards} />
      {items.length > shown && <ShowMore onClick={() => setShown((n) => n + PAGE)}>Show {items.length - shown} more</ShowMore>}
    </details>
  );
}

/**
 * "13 packs from your industries" and one button for all of them: "Add all 54" counts each company
 * once, even when it sits in two packs, then "Add 20 more". Orange only as the way to start, at 0
 * companies. Once every pack is in, the line says so and the same button opens My companies (it
 * ignores presses for a moment after an add, so a double press doesn't jump away). One button
 * throughout, so focus never drops.
 */
function PacksHeader({
  packs,
  finished,
  watched,
  actions,
  onSeeMine,
}: {
  packs: { industry: string; items: CompanySuggestion[] }[];
  finished: Finished[];
  watched: Set<string>;
  actions: PackActions;
  onSeeMine?: () => void;
}) {
  const lastAdd = useRef(0);
  const all = uniqueMembers(packs);
  if (!all.length) return null;
  const { kind, todo } = packState(all, watched);
  const packOf = (r: CompanyRef) => packs.find((p) => p.items.some((s) => keyOf(s) === keyOf(r)))?.industry ?? null;
  const n = packs.length + finished.length;
  const done = kind === "done";
  const total = new Set([...all.map((s) => s.key), ...finished.flatMap((f) => f.keys)]).size;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {done ? (
        <p className="flex min-w-0 flex-1 items-center gap-1.5 type-small text-ink">
          <CircleCheck className="size-4 shrink-0 text-success-text" aria-hidden />
          {total === 1 ? "The starter-pack company is in My companies" : `All ${total} starter-pack companies are in My companies`}
        </p>
      ) : (
        <p className="min-w-0 flex-1 type-small text-muted">
          {n} {n === 1 ? "pack" : "packs"} from your industries
        </p>
      )}
      {(!done || onSeeMine) && (
        <Button
          size="sm"
          variant={watched.size === 0 ? "primary" : "outline"}
          onClick={() => {
            if (done) {
              if (Date.now() - lastAdd.current >= DOUBLE_PRESS_MS) onSeeMine?.();
              return;
            }
            lastAdd.current = Date.now();
            const refs = all.filter((s) => !isAdded(watched, s)).map(refOf);
            actions.add(refs, (k) => `Added ${k} from ${n} ${n === 1 ? "pack" : "packs"}`, packOf);
          }}
        >
          {!done && <Plus className="size-3.5" />}
          {done ? "See My companies" : kind === "all" ? `Add all ${todo}` : `Add ${todo} more`}
        </Button>
      )}
    </div>
  );
}

/** "You've added all 19 companies from your 3 packs." */
function packsDone(finished: Finished[]) {
  const n = new Set(finished.flatMap((f) => f.keys)).size;
  const packs = finished.length === 1 ? "your pack" : `your ${finished.length} packs`;
  return n === 1 ? `You've added the company from ${packs}.` : `You've added all ${n} companies from ${packs}.`;
}

/** "All 30 are in your list." */
const inYourList = (n: number) => (n === 1 ? "It's in your list." : `All ${n} are in your list.`);

/** In the bulk add's place once a list is all in: "All 30 in My companies". */
function AllInMine({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap type-small text-muted">
      <Check className="size-3.5 shrink-0" aria-hidden />
      {n === 1 ? "In My companies" : `All ${n} in My companies`}
    </span>
  );
}

/**
 * A lens you've added everything from: a check, what's done and what comes next, on a solid border so
 * it never reads as the dashed "nothing found".
 */
function AllAdded({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode[] }) {
  const shown = actions.filter(Boolean);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-hairline bg-canvas p-4 type-small motion-safe:animate-[rj-fade_var(--duration-quick)_var(--ease-enter)]">
      <CircleCheck className="row-span-3 mt-px size-5 text-success-text" aria-hidden />
      <p className="font-semibold text-balance">{title}</p>
      <p className="text-muted">{children}</p>
      {shown.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{shown}</div>}
    </div>
  );
}

/** Nothing found: a dashed border and no icon. With a title, it says why and offers ways on. */
function Empty({ title, actions, children }: { title?: string; actions?: ReactNode[]; children: ReactNode }) {
  if (!title) return <p className="rounded-md border border-dashed border-line p-4 type-small text-muted">{children}</p>;
  const shown = (actions ?? []).filter(Boolean);
  return (
    <div className="grid gap-1 rounded-md border border-dashed border-line p-4 type-small">
      <p className="font-semibold">{title}</p>
      <p className="text-muted">{children}</p>
      {shown.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{shown}</div>}
    </div>
  );
}

/** What only this lookalike says: "Like Careem: Mobility · hires Product Management" without the name the header has. */
const likeWhy = (s: CompanySuggestion) => {
  const why = s.reasons.find((r) => r.startsWith("Like "))?.replace(/^Like [^:]*:\s*/, "");
  return why ? why.charAt(0).toUpperCase() + why.slice(1) : undefined;
};

function LikeLens({
  rows,
  goBack,
  hasEmployers,
  allAdded,
  cards,
  compact,
  watched,
  onAddMany,
  onRemoveMany,
  onDismiss,
}: {
  rows: { seed: string; in_directory: boolean; items: CompanySuggestion[] }[];
  goBack: CompanySuggestions["pastEmployers"];
  hasEmployers: boolean;
  /** Shown in place of "no close match" when every lookalike is in My companies. */
  allAdded?: ReactNode;
  cards: (items: CompanySuggestion[], note?: (s: CompanySuggestion) => string | undefined) => ReactNode;
  compact?: boolean;
  watched: Set<string>;
  onAddMany: (list: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState<string[]>([]);
  if (!hasEmployers)
    return (
      <div className="rounded-md border border-dashed border-line p-4 type-small">
        <p className="font-semibold">No past employers yet</p>
        <p className="mt-1 text-muted">Add a company you've worked at to see companies like it. Past employers are only checked if you also add them to My companies.</p>
      </div>
    );
  return (
    <div className="space-y-5">
      {rows.length === 0 && (allAdded || <Empty>No close match yet for your past employers among companies that fit your roles and places.</Empty>)}
      {rows.map((r) => (
        <section key={r.seed} className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="min-w-0 flex-1 type-small font-semibold">
              Because you worked at {r.seed}
              {!r.in_directory && <span className="ml-2 type-small font-normal text-muted">(matched on the industries in that role on your resume)</span>}
            </h3>
            <AddAll items={r.items.map(refOf)} watched={watched} onAddMany={onAddMany} onRemoveMany={onRemoveMany} />
          </div>
          {cards(r.items.slice(0, open.includes(r.seed) ? r.items.length : compact ? 2 : 3), likeWhy)}
          {!open.includes(r.seed) && r.items.length > (compact ? 2 : 3) && <ShowMore onClick={() => setOpen((o) => [...o, r.seed])}>Show {r.items.length - (compact ? 2 : 3)} more</ShowMore>}
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

/**
 * One card per industry. Chips are name-only toggles that flip in place; the pack button counts what's
 * left ("Add all 8", "Add 4 more"), then offers Remove pack once "All added" shows under the chips.
 * Both come from your companies, not this visit, so a finished pack still offers Remove pack after a
 * reload. Progress ("4 of 8 added") shows below the chips once you've started a pack, so nothing
 * above the one you pressed moves.
 */
function Packs({
  packs,
  finished,
  nextUp,
  watched,
  actions,
  onPick,
}: {
  packs: { industry: string; items: CompanySuggestion[] }[];
  finished: Finished[];
  nextUp: NextUp;
  watched: Set<string>;
  actions: PackActions;
  onPick: (industry: string, s: CompanySuggestion) => void;
}) {
  return (
    <>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {packs.map((p) => (
          <PackCard key={p.industry} pack={p} next={nextUp[p.industry]} watched={watched} actions={actions} onPick={(s) => onPick(p.industry, s)} />
        ))}
      </div>
      <FinishedPacks finished={finished} actions={actions} />
    </>
  );
}

/**
 * Packs you've fully added, folded into one line after the ones with something left: "10 packs fully
 * added · Show". It opens below itself, so nothing above it moves, and focus stays on the toggle.
 */
function FinishedPacks({ finished, actions }: { finished: Finished[]; actions: PackActions }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!finished.length) return null;
  const n = finished.length;
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="group/fin inline-flex min-h-8 items-center gap-1.5 rounded-md type-small text-muted pointer-coarse:min-h-11 hover:text-ink"
      >
        <CircleCheck className="size-4 shrink-0 text-success-text" aria-hidden />
        {n} {n === 1 ? "pack" : "packs"} fully added
        <span aria-hidden>·</span>
        {/* The state is aria-expanded's to say, so the name stays the same. */}
        <span aria-hidden className="type-label text-ink underline underline-offset-2 group-hover/fin:text-muted">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      <div id={listId} hidden={!open} className={cx(open ? "grid" : "hidden", "items-start gap-3 md:grid-cols-2 xl:grid-cols-3")}>
        {open && finished.map((f) => <FinishedPack key={f.industry} pack={f} actions={actions} />)}
      </div>
    </div>
  );
}

/**
 * A pack with nothing left to suggest (its industry has no more companies for you): a short card at
 * the end, so it doesn't vanish without a word, still with Remove pack.
 */
function FinishedPack({ pack: f, actions }: { pack: Finished; actions: PackActions }) {
  const headingId = useId();
  const label = packLabel(f.industry);
  const n = f.keys.length;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-4">
      <header className="flex items-start gap-2">
        <h3 id={headingId} className="flex min-w-0 flex-1 items-start gap-2 pt-1 type-small font-semibold">
          <Package className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          {label}
        </h3>
        <Button size="sm" variant="ghost" aria-label={`Remove the ${label} pack`} onClick={() => actions.remove(f.keys, (k) => `Removed ${k} from ${label}`)}>
          Remove pack
        </Button>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="h-1 bg-ink" aria-hidden />
        <span className="inline-flex items-center gap-1 whitespace-nowrap type-meta text-muted">
          <Check className="size-3.5" aria-hidden /> {n === 1 ? "1 in My companies" : `All ${n} in My companies`}
        </span>
      </div>
    </section>
  );
}

/**
 * Picking one company in a pack brings the next ones from it ("Next in this pack, after Kraken"):
 * they join the end of the chips, the new ones with a dot until the next change, so nothing moves.
 */
function PackCard({
  pack: p,
  next,
  watched,
  actions,
  onPick,
}: {
  pack: { industry: string; items: CompanySuggestion[] };
  next?: NextUp[string];
  watched: Set<string>;
  actions: PackActions;
  onPick: (s: CompanySuggestion) => void;
}) {
  const headingId = useId();
  const label = packLabel(p.industry);
  const { kind, done, todo, total } = packState(p.items, watched);
  const act = () => {
    if (kind === "done") actions.remove(p.items.map(keyOf), (k) => `Removed ${k} from ${label}`);
    else
      actions.add(
        p.items.filter((s) => !isAdded(watched, s)).map(refOf),
        (k) => `Added ${k} from ${label}`,
        () => p.industry,
      );
  };
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-md border border-line p-4">
      <header className="flex items-start gap-2">
        <h3 id={headingId} className="flex min-w-0 flex-1 items-start gap-2 pt-1 type-small font-semibold">
          <Package className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          {label}
        </h3>
        {/* Every label fills one cell sized by the widest, so the header never reflows; and it's one
            button throughout, so focus stays on it. */}
        <div className="grid shrink-0 justify-items-end">
          <span aria-hidden className="invisible col-start-1 row-start-1 grid justify-items-end">
            <span className={buttonClass("secondary", "sm", "col-start-1 row-start-1")}>
              <Plus className="size-3.5" /> Add {total} more
            </span>
            <span className={buttonClass("secondary", "sm", "col-start-1 row-start-1")}>Remove pack</span>
          </span>
          <Button size="sm" variant={kind === "done" ? "ghost" : "outline"} className="col-start-1 row-start-1" aria-label={kind === "done" ? `Remove the ${label} pack` : undefined} onClick={act}>
            {kind !== "done" && <Plus className="size-3.5" />}
            {kind === "all" ? `Add all ${todo}` : kind === "more" ? `Add ${todo} more` : "Remove pack"}
          </Button>
        </div>
      </header>
      <ul className="flex flex-wrap gap-1.5">
        {p.items.map((s) => (
          <li key={s.key} className="max-w-full">
            <PackChip
              s={s}
              on={isAdded(watched, s)}
              fresh={!!next?.fresh.includes(s.key)}
              onToggle={(on) => (on ? actions.remove([s.key, keyOf(s)], () => `Removed ${companyLabel(s)}`) : onPick(s))}
            />
          </li>
        ))}
      </ul>
      {next && <p className="-mt-1 type-meta text-muted">Next in this pack, after {next.after}</p>}
      {done > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <span className="h-1 overflow-hidden bg-active" aria-hidden>
            <span className="block h-full origin-left bg-ink transition-transform duration-200 ease-enter" style={{ transform: `scaleX(${done / total})` }} />
          </span>
          {kind === "done" ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap type-meta text-muted">
              <Check className="size-3.5" aria-hidden /> All added
            </span>
          ) : (
            <span className="tabular whitespace-nowrap type-meta text-muted">
              {done} of {total} added
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A company in a pack: its name and a plus; once added, filled with a check (and an x on hover, as
 * the way to remove it). The icons share one slot, so the chip keeps its width.
 */
function PackChip({ s, on, fresh, onToggle }: { s: CompanySuggestion; on: boolean; fresh?: boolean; onToggle: (on: boolean) => void }) {
  const name = companyLabel(s);
  return (
    <Chip
      pressed={on}
      onClick={() => onToggle(on)}
      aria-label={`${on ? `${name}, in My companies. Press to remove` : `${name}, add to My companies`}${fresh ? ". New in this pack" : ""}`}
      title={companyReasons(s.reasons).join(" · ") || undefined}
      className={cx("group max-w-full pr-2 pl-2.5", fresh && "motion-safe:animate-[rj-fade_var(--duration-base)_var(--ease-enter)]")}
    >
      {fresh && <span className="rj-dot" aria-hidden />}
      <span className="min-w-0 truncate">{name}</span>
      <span className="relative size-3.5 shrink-0" aria-hidden>
        <Plus className="absolute inset-0 size-3.5 transition-[opacity,transform] group-aria-pressed:scale-75 group-aria-pressed:opacity-0" />
        <Check className="absolute inset-0 size-3.5 scale-75 opacity-0 transition-[opacity,transform] group-aria-pressed:scale-100 group-aria-pressed:opacity-100 group-aria-pressed:group-hover:scale-75 group-aria-pressed:group-hover:opacity-0" />
        <X className="absolute inset-0 size-3.5 scale-75 opacity-0 transition-[opacity,transform] group-aria-pressed:group-hover:scale-100 group-aria-pressed:group-hover:opacity-100" />
      </span>
    </Chip>
  );
}

/** The companies on your resume, as editable chips. They seed "companies like them". */
export function PastEmployers({ names, suggested = [], onChange }: { names: string[]; suggested?: string[]; onChange: (names: string[]) => void }) {
  const [text, setText] = useState("");
  const inputId = useId();
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
    <form
      aria-label="Past employers"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label htmlFor={inputId} className="mr-1 inline-flex items-center gap-1.5 type-label">
        <Briefcase className="size-4 text-muted" aria-hidden /> You've worked at
      </label>
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
      <span className="flex w-full max-w-sm gap-2">
        <input id={inputId} value={text} onChange={(e) => setText(e.target.value)} placeholder="Company name, e.g. Careem" autoComplete="off" className="rj-input h-9 min-w-0 flex-1 type-small" />
        <Button type="submit">Add employer</Button>
      </span>
    </form>
  );
}
