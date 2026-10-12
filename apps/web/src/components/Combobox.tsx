import { Plus, Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export type ComboItem = { key: string; label: string; hint?: ReactNode; group?: string };

type Props = {
  label: string;
  placeholder: string;
  search: (q: string) => ComboItem[];
  onPick: (item: ComboItem) => void;
  /** Called with the typed text on Enter when nothing is highlighted. Omit to disallow free text. */
  onFreeText?: (text: string) => void;
};

/** Search-as-you-type picker: arrow keys + Enter, or click. Keeps focus so several can be added in a row. */
export function Combobox({ label, placeholder, search, onPick, onFreeText }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => (q.trim() ? search(q) : []), [q, search]);

  const pick = (item: ComboItem) => {
    onPick(item);
    setQ("");
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (items[active]) pick(items[active]!);
            else if (onFreeText && q.trim()) {
              onFreeText(q.trim().toLowerCase());
              setQ("");
            }
          } else if (e.key === "Escape") {
            setQ("");
            setOpen(false);
          }
        }}
        className="h-11 w-full rounded-md border border-line bg-raised pl-9 pr-3 type-small placeholder:text-muted"
      />
      {open && q.trim() && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-l3">
          {items.length === 0 ? (
            <li className="px-3 py-2 type-small text-muted">
              {onFreeText ? (
                <>
                  No match. Press <b className="text-ink">Enter</b> to add “{q.trim().toLowerCase()}” as typed.
                </>
              ) : (
                "No match."
              )}
            </li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(i)}
                className={cx("flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 type-small", i === active && "bg-inset")}
              >
                <Plus className="size-3.5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                {item.hint && <span className="hidden max-w-[55%] truncate type-small text-muted sm:block">{item.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
