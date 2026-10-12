import { Check, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { keyOf, SUPPORTED, type CompanyRef } from "../lib/companies";
import { Button } from "./ui";

/**
 * Add to / remove from My companies. `name` makes the label specific for screen readers ("Add Acme").
 * Outlined, never orange: a list shows many of these, and the accent is kept for one main action per view.
 */
export function AddButton({
  added,
  onAdd,
  onRemove,
  soon,
  name,
  addedText = "Added",
}: {
  added: boolean;
  onAdd: () => void;
  onRemove: () => void;
  soon?: boolean;
  name?: string;
  /** What an added one says ("Watching", for companies not hiring for you yet). */
  addedText?: string;
}) {
  return added ? (
    <Button size="sm" onClick={onRemove} aria-pressed className="border-ink bg-active text-ink" aria-label={name ? `${addedText} ${name}` : undefined} title="In My companies. Click to remove">
      <Check className="size-3.5" /> {addedText}
    </Button>
  ) : (
    <Button size="sm" onClick={onAdd} aria-label={name ? `Add ${name}` : undefined} title={soon ? "Not supported yet: it's scanned once its hiring system is supported" : "Add to My companies"}>
      <Plus className="size-3.5" /> Add
    </Button>
  );
}

/**
 * "Add all (N)" for a list, then "Added N · Undo" until the list changes. `primary`: the view's one
 * main action (orange). `label` words the button instead ("Add top 10").
 */
export function AddAll({
  items,
  watched,
  onAddMany,
  onRemoveMany,
  primary,
  label,
}: {
  items: CompanyRef[];
  watched: Set<string>;
  onAddMany: (c: CompanyRef[]) => string[];
  onRemoveMany: (keys: string[]) => void;
  primary?: boolean;
  label?: (n: number) => string;
}) {
  const [last, setLast] = useState<{ keys: string[]; soon: number } | null>(null);
  const todo = items.filter((c) => !watched.has(keyOf(c)));
  if (last?.keys.some((k) => watched.has(k))) {
    const scannable = last.keys.length - last.soon;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 type-small text-muted">
        <span>
          <Check className="mr-1 inline size-3.5 text-ink" aria-hidden />
          Added {last.keys.length}
          {last.soon > 0 && ` (${scannable} can scan now, ${last.soon} not supported yet)`}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2 hover:text-muted"
          onClick={() => {
            onRemoveMany(last.keys);
            setLast(null);
          }}
        >
          <Undo2 className="size-3.5" /> Undo
        </button>
      </span>
    );
  }
  if (todo.length === 0) return null;
  return (
    <Button
      size="sm"
      variant={primary ? "primary" : "outline"}
      onClick={() => {
        const keys = onAddMany(todo);
        const soon = todo.filter((c) => keys.includes(keyOf(c)) && !SUPPORTED.has(c.ats)).length;
        setLast({ keys, soon });
      }}
    >
      <Plus className="size-3.5" /> {label ? label(todo.length) : `Add all (${todo.length})`}
    </Button>
  );
}
