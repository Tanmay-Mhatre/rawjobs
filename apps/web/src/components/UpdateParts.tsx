import { type ReleaseChange, releaseItems } from "@rawjobs/core/release-notes";
import { ArrowRight, ChevronDown, type LucideIcon, LoaderCircle, Terminal, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import mark from "../design/logos/rawjobs-mark.svg";
import { cx } from "./ui";

/**
 * The pieces every update screen is built from (the required-update window, the Update pill's
 * cards, Updating, What's new, the "went back" notice), so they read as one system: an icon slot,
 * "0.6.0 → 0.6.1 · label", short icon points, and changes with their tags, New first.
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

/** The icon slot: the app icon (a spinner badge while updating), or an alert / warning / terminal square. */
export function Anchor({ kind, busy = false, size = "lg" }: { kind: "mark" | "alert" | "warn" | "terminal"; busy?: boolean; size?: "sm" | "lg" }) {
  const box = size === "sm" ? "size-8" : "size-10 sm:size-12";
  if (kind === "mark")
    return (
      <span aria-hidden className={cx("relative shrink-0", box)}>
        {/* The border keeps the icon's dark square visible on a dark card. */}
        <img src={mark} alt="" className="size-full rounded-md border border-control" />
        {busy && (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-md border border-control bg-raised text-ink">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          </span>
        )}
      </span>
    );
  const tone = {
    alert: "border-danger-text bg-danger-subtle text-danger-text",
    warn: "border-warning-text bg-warning-subtle text-warning-text",
    terminal: "border-control bg-inset text-ink",
  }[kind];
  const Glyph = kind === "terminal" ? Terminal : TriangleAlert;
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-md border", box, tone)}>
      <Glyph className={size === "sm" ? "size-4" : "size-6"} />
    </span>
  );
}

/** "0.6.0 → 0.6.1 · Updated" (no arrow when there's no `to`). */
export function VersionLine({ from, to, label, className }: { from: string; to?: string; label?: string; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 type-small text-muted tabular-nums", className)}>
      <span>{from}</span>
      {to && (
        <>
          <ArrowRight className="size-3.5" aria-label="to" />
          <span className="font-medium text-ink">{to}</span>
        </>
      )}
      {label && (
        <>
          <span aria-hidden>·</span>
          <span>{label}</span>
        </>
      )}
    </p>
  );
}

/** The icon, the title, and the version line under it. */
export function Head({ id, anchor, title, from, to, label }: { id: string; anchor: ReactNode; title: string; from: string; to: string; label: string }) {
  return (
    <div className="flex items-center gap-4">
      {anchor}
      <div className="min-w-0">
        <h2 id={id} className="type-heading text-balance">
          {title}
        </h2>
        <VersionLine from={from} to={to} label={label} className="mt-1" />
      </div>
    </div>
  );
}

/** Short points, an icon each: what it takes, what happens to your data. */
export function Points({ items, className = "mt-4" }: { items: [LucideIcon, ReactNode][]; className?: string }) {
  return (
    <ul className={cx("grid gap-2", className)}>
      {items.map(([I, text], n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
        <li key={n} className="flex items-start gap-2 type-small text-ink">
          <I className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

const ORDER: Record<ReleaseChange["type"], number> = { new: 0, improved: 1, fixed: 2 };
export type Item = { type: ReleaseChange["type"] | null; text: string; i: number };

/** A release's lines, New first, then Improved, then Fixed (release order within each). */
export function sortedItems(notes: string, changes?: ReleaseChange[]): Item[] {
  return releaseItems(notes, changes)
    .map((c, i) => ({ ...c, i }))
    .sort((x, y) => (x.type && y.type ? ORDER[x.type] - ORDER[y.type] : 0) || x.i - y.i);
}

/** Changes as rows: the tag (a word on a quiet tint), then the sentence. */
export function ChangeRows({ items }: { items: Item[] }) {
  const tagged = items.some((c) => c.type);
  return (
    <ul className="grid gap-2">
      {items.map((c) => (
        <li key={c.i} className={cx("grid items-start gap-2 type-small text-ink", tagged ? "grid-cols-[4.75rem_minmax(0,1fr)]" : "grid-cols-[0.75rem_minmax(0,1fr)]")}>
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
}

/** "See all n changes" / "Show fewer", opening `children` in place. */
export function SeeAll({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="-ml-2 inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 type-label text-muted hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">See all {count} changes</span>
        <span className="hidden group-open:inline">Show fewer</span>
        <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
