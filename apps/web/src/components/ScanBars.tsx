import { ChevronDown, ChevronUp, CircleCheck } from "lucide-react";
import { useId, useState } from "react";
import { shortCount } from "../lib/format";
import { splitProgress } from "../lib/scan";
import { useMedia } from "../lib/useMedia";
import { SourceTag } from "./primitives";
import { Button } from "./ui";

export type ScanBar = { key: string; label: string; done: number; total: number; feed?: true };

const plural = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

/**
 * A scan's progress by hiring system (or by source): up to five rows (three on phones), biggest
 * first; finished ones fold into one "3 hiring systems done" line, the rest open with "Show all".
 * Short lists show every row in place. `onExpand` lets a hover pop-over stay open while it's read.
 */
export function ScanBars({ rows, noun, onExpand }: { rows: ScanBar[]; noun: "hiring system" | "source"; onExpand?: () => void }) {
  const phone = useMedia("(max-width: 639px)");
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!rows.length) return null;
  const { shown, rest, done, inPlace } = splitProgress(rows, phone ? 3 : 5);
  const open = shown.length + rest.length;
  const list = expanded ? [...shown, ...rest] : shown;
  return (
    <div className="mt-4">
      <p id={`${id}-label`} className="mb-2 type-meta text-muted">
        By {noun}
      </p>
      {list.length > 0 && (
        <ul id={`${id}-list`} aria-labelledby={`${id}-label`} className={expanded ? "rj-progress rj-progress--scroll" : "rj-progress"} tabIndex={expanded ? 0 : undefined}>
          {list.map((b) => (
            <Row key={b.key} bar={b} />
          ))}
        </ul>
      )}
      {!inPlace && done.length > 0 && (
        <p className="rj-progress__done mt-3">
          <CircleCheck className="rj-icon" aria-hidden />
          <span>{open ? `${plural(done.length, noun)} done` : `All ${plural(done.length, noun)} checked`}</span>
        </p>
      )}
      {rest.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="rj-progress__more mt-2"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          onClick={() => {
            setExpanded((e) => !e);
            onExpand?.();
          }}
        >
          {expanded ? "Show fewer" : `Show all ${plural(open, noun)}`}
          {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
        </Button>
      )}
    </div>
  );
}

function Row({ bar: b }: { bar: ScanBar }) {
  const finished = !!b.feed || (b.total > 0 && b.done >= b.total);
  const counts = b.feed ? "done" : `${b.done.toLocaleString()} of ${b.total.toLocaleString()} companies`;
  return (
    <li className="rj-progress__row" data-done={finished || undefined} title={`${b.label}: ${counts}`}>
      <SourceTag source={b.label} />
      <span className="rj-progress__track" aria-hidden>
        <span className="rj-progress__fill" style={{ transform: `scaleX(${b.feed ? 1 : b.total ? b.done / b.total : 0})` }} />
      </span>
      <span className="rj-progress__count" aria-hidden>
        {b.feed ? "done" : `${shortCount(b.done)} / ${shortCount(b.total)}`}
      </span>
      <span className="sr-only">{counts}</span>
    </li>
  );
}
