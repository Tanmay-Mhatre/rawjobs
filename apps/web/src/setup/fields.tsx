import { Check, ChevronDown } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { toast } from "../components/Toast";
import { Button, cx } from "../components/ui";
import type { Suggestions } from "../lib/suggest";
import type { Draft } from "../lib/setup";

/** Pieces the setup steps (and Settings) share: fields, sections, clear buttons. */
export type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void; suggest?: Suggestions };

/** Heading level for section titles inside a step: 2 under the wizard's h1, 3 under a Settings h2. */
export const HeadingLevel = createContext<2 | 3>(3);
export function SectionHeading({ children }: { children: ReactNode }) {
  const H = useContext(HeadingLevel) === 2 ? "h2" : "h3";
  return <H className="type-small font-semibold">{children}</H>;
}

export function Field({ label, hint, action, children }: { label: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {/* Room for the action (a Clear that appears with the first pick), so picking doesn't push the chips down. */}
      <div className={cx("flex items-start gap-2", action != null && "min-h-7")}>
        <div className="min-w-0 flex-1">
          <SectionHeading>{label}</SectionHeading>
          {hint && <p className="mt-0.5 type-small text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A clear for these draft fields, and an undo that puts back what they hold now. */
export function clearing(draft: Draft, update: (patch: Partial<Draft>) => void, patch: Partial<Draft>) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, draft[k as keyof Draft]])) as Partial<Draft>;
  return { onClear: () => update(patch), onUndo: () => update(before) };
}

/**
 * "Clear" for a section with picks: empties it at once and offers Undo in a toast.
 * Renders nothing when there's nothing to clear.
 */
export function ClearButton({
  count,
  noun,
  onClear,
  onUndo,
  label = "Clear",
  message,
  name,
}: {
  count: number;
  /** [one, many], e.g. ["title", "titles"]. */
  noun: [string, string];
  onClear: () => void;
  onUndo: () => void;
  label?: string;
  /** Toast text, when "Cleared 3 titles." doesn't read well. */
  message?: string;
  /** Accessible name when several clears on a page share a noun, e.g. "Clear Payments & banking industries". */
  name?: string;
}) {
  if (!count) return null;
  const what = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0"
      aria-label={name ?? `${label} ${noun[1]}`}
      onClick={() => {
        onClear();
        toast({ message: message ?? `Cleared ${what}.`, actionLabel: "Undo", onAction: onUndo });
      }}
    >
      {label}
    </Button>
  );
}

export function PickButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx("inline-flex h-9 items-center gap-1.5 rounded-md border px-3 type-label transition-colors", active ? "border-ink bg-ink text-raised" : "border-line bg-raised hover:bg-inset")}
    >
      {active && <Check className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];
export const hasAll = (a: string[], b: string[]) => b.every((x) => a.includes(x));

/** Secondary settings, collapsed until wanted. The summary says what's inside without opening it. */
export function MoreOptions({ summary, children }: { summary?: string; children: ReactNode }) {
  return (
    <details className="group rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 type-label">
        <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
        More options
        {summary && <span className="ml-auto truncate pl-2 font-normal text-muted">{summary}</span>}
      </summary>
      <div className="space-y-6 border-t border-line p-3 sm:p-4">{children}</div>
    </details>
  );
}

export function Section({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm bg-inset type-label text-ink">{n}</span>
        <div className="min-w-[14rem] flex-1">
          <SectionHeading>{title}</SectionHeading>
          {hint && <p className="mt-0.5 type-small text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="sm:pl-8">{children}</div>
    </section>
  );
}

/** The label on suggestions taken from the resume. */
export const RESUME_LABEL = (s?: Suggestions) => (s?.source === "ai" ? "From your master resume" : "From your resume");
