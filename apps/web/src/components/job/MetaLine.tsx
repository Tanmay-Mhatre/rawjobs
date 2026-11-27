import { Fragment, type ReactNode } from "react";

/** Plain text pieces joined by the kit's " · " separator. */
export function MetaLine({ parts, className }: { parts: ReactNode[]; className?: string }) {
  return (
    <p className={className}>
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list rebuilt from the same input, never reordered: the index is a stable key
        <Fragment key={i}>
          {i > 0 && (
            <span className="rj-sep" aria-hidden>
              ·
            </span>
          )}
          {/* Each part wraps as a whole ("Copperkettle Pay" never splits across lines) unless it's wider than the line. */}
          <span className="inline-block max-w-full">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}
