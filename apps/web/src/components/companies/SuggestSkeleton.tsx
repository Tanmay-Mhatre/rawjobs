import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { matchEstimate } from "../../lib/companySuggest";
import { cx } from "../ui";
import { CardSkeleton } from "./SuggestionCard";

export type Lens = "hiring" | "like" | "watching" | "packs" | "soon";

/** After this long, the status line says why it's still going. */
export const SLOW_MS = 10_000;

/**
 * The lens the page opens on before the answer is in (it isn't remembered between visits): Starter
 * packs when you have industries, or at 0 companies (where it says how to get packs), else Hiring for
 * you now. The same rule ForYou uses once the answer is in, as far as it can be told without it.
 */
export const openingLens = (industries: number | undefined, companies: number): Lens => (industries || companies === 0 ? "packs" : "hiring");

/**
 * "Matching 24,687 companies to your profile" (the real count, or no number while it isn't known);
 * after 10 seconds, how long the last match took here, which is the honest estimate there is.
 */
export function MatchingStatus({ companies }: { companies?: number | null }) {
  const [estimate] = useState(matchEstimate);
  const [phase, setPhase] = useState<"start" | "slow" | "over">("start");
  useEffect(() => {
    const slow = setTimeout(() => setPhase("slow"), SLOW_MS);
    // Well past last time's length: say so rather than repeat an estimate that's now wrong.
    const over = estimate ? setTimeout(() => setPhase("over"), Math.max(estimate * 1000 + 5000, SLOW_MS)) : undefined;
    return () => {
      clearTimeout(slow);
      clearTimeout(over);
    };
  }, [estimate]);
  const text =
    phase === "start"
      ? companies
        ? `Matching ${companies.toLocaleString()} companies to your profile`
        : "Matching companies to your profile"
      : !estimate
        ? "Still matching. The first match after RawJobs starts takes the longest."
        : phase === "slow"
          ? `Still matching. Last time it took about ${estimate} seconds.`
          : `Still matching. This is taking longer than last time (about ${estimate} seconds).`;
  return (
    <p role="status" className="flex min-w-0 flex-1 items-center gap-2 type-small text-muted">
      <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

const Bar = ({ className, style }: { className?: string; style?: CSSProperties }) => <span className={cx("rj-skel", className)} style={style} />;

/** A small button's shape (28 px, 44 on touch screens, like the button itself). */
const ButtonBar = ({ width }: { width: number }) => <Bar className="h-7 shrink-0 rounded-md pointer-coarse:h-11" style={{ width }} />;

/**
 * The lens tabs as bars, each as wide as its label would be (the label is there, transparent), so
 * they wrap onto the same lines as the real tabs on a phone.
 */
function TabsSkeleton({ industries }: { industries?: number }) {
  const labels = [`Starter packs${industries ? ` ${industries}` : ""}`, "Hiring for you now 30", "Like your past employers 6", "Not hiring yet 30"];
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="rj-tabs rj-tabs--wrap min-w-0 flex-1">
        {labels.map((l) => (
          <span key={l} className="flex min-h-11 items-center py-3">
            <span className="rj-skel h-3 w-fit select-none whitespace-nowrap type-label text-transparent">{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The line above a lens's content: the status where the lens's intro goes, a bar where its Add all goes. */
function HeaderRow({ status, button }: { status: ReactNode; button: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {status}
      <span aria-hidden className="contents">
        <ButtonBar width={button} />
      </span>
    </div>
  );
}

const CHIPS = [92, 66, 82, 74, 116, 98, 112, 72];

/** One starter pack: icon and name, its Add all, then chip-shaped bars that wrap like the chips. */
function PackSkeleton({ className }: { className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-3 rounded-md border border-line p-4", className)} aria-hidden data-skeleton="pack">
      <div className="flex items-start gap-2">
        <p className="flex h-[1.5625rem] min-w-0 flex-1 items-center gap-2 pt-1">
          <Bar className="size-4 shrink-0" />
          <Bar className="h-3 w-28" />
        </p>
        <ButtonBar width={76} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of widths, never reordered
          <Bar key={i} className="h-7 rounded-sm pointer-coarse:h-11" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/** Cards in the lens's grid: all of them from a tablet up, the first `phone` on a phone. */
function Cards({ n, phone, compact }: { n: number; phone: number; compact?: boolean }) {
  return (
    <div className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered
        <CardSkeleton key={i} className={i >= phone ? "max-sm:hidden" : undefined} />
      ))}
    </div>
  );
}

/**
 * Suggestions while the first answer is worked out: the tabs, then the lens that will open, drawn in
 * the boxes its real parts take, so nothing moves when they arrive. The status line sits where the
 * lens's intro goes. Bars show after 100 ms (a kept answer comes back sooner, so it never flashes)
 * and, with reduced motion, don't shimmer.
 */
export function SuggestSkeleton({
  lens,
  industries,
  compact,
  status,
  needIndustries,
}: {
  lens: Lens;
  industries?: number;
  compact?: boolean;
  status: ReactNode;
  /** Shown in Starter packs when there are no industries to make packs from (it doesn't depend on the answer). */
  needIndustries?: ReactNode;
}) {
  const packs = Math.min(Math.max(industries ?? 3, 1), 3);
  return (
    <div className="mt-4 space-y-4 animate-[rj-fade_var(--duration-quick)_var(--ease-enter)_100ms_backwards]" aria-busy="true" data-lens={lens}>
      <TabsSkeleton industries={industries} />
      <div className="space-y-4">
        {lens === "packs" ? (
          needIndustries ? (
            <>
              {status}
              {needIndustries}
            </>
          ) : (
            <>
              <HeaderRow status={status} button={92} />
              <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: packs }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered
                  <PackSkeleton key={i} className={i >= 2 ? "max-md:hidden" : undefined} />
                ))}
              </div>
            </>
          )
        ) : lens === "like" ? (
          <>
            <div className="flex flex-wrap items-center gap-2" aria-hidden>
              <span className="mr-1 inline-flex h-5 items-center gap-1.5">
                <Bar className="size-4" />
                <Bar className="h-3 w-24" />
              </span>
              <Bar className="h-7 w-20 rounded-sm pointer-coarse:h-11" />
              <span className="flex w-full max-w-sm gap-2">
                <Bar className="h-9 min-w-0 flex-1 rounded-md" />
                <Bar className="h-9 w-[7.375rem] rounded-md pointer-coarse:h-11" />
              </span>
            </div>
            <div className="space-y-5">
              <section className="space-y-2.5">
                <HeaderRow status={status} button={84} />
                <Cards n={3} phone={2} compact={compact} />
              </section>
            </div>
          </>
        ) : (
          <>
            <HeaderRow status={status} button={lens === "soon" ? 84 : 98} />
            <div className="space-y-5">
              <section className="space-y-2.5">
                <div className="flex h-[1.3125rem] items-center gap-3" aria-hidden>
                  <Bar className="h-3 w-32" />
                  <Bar className="h-2.5 w-56 max-w-[50%]" />
                </div>
                <Cards n={6} phone={2} compact={compact} />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
