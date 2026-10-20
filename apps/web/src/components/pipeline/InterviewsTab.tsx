import { Plus, X } from "lucide-react";
import { type FormEvent, useId } from "react";
import type { Entry, EntryPatch, Interview } from "../../lib/userState";
import { IconButton, Select } from "../ui";

const input = "h-9 min-w-0 rounded-md border border-line bg-raised px-2.5 type-small text-ink placeholder:text-muted";
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** The Interviews tab: each round with its day, time and person, soonest first; added in one line. */
export function InterviewsTab({ entry, onUpdate }: { entry: Entry; onUpdate: (patch: EntryPatch) => void }) {
  const id = useId();
  const contacts = entry.contacts ?? [];
  const all = entry.interviews ?? [];
  const interviews = [...all].sort((a, b) => `${a.on}${a.time ?? ""}`.localeCompare(`${b.on}${b.time ?? ""}`));
  const nameOf = (cid?: string) => (cid ? (contacts.find((c) => c.id === cid)?.name ?? "Removed person") : undefined);

  const add = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const on = String(f.get("on") ?? "");
    if (!on) return;
    const time = String(f.get("time") ?? "");
    const contactId = String(f.get("person") ?? "");
    const next: Interview = { on, what: String(f.get("what") ?? "").trim() || "Interview", ...(time ? { time } : {}), ...(contactId ? { contactId } : {}) };
    onUpdate({ interviews: [...all, next] });
    ev.currentTarget.reset();
  };

  return (
    <div className="grid gap-3">
      {interviews.length === 0 ? (
        <p className="type-small text-muted">No interviews yet. Add each round when it's booked: it shows in Next steps, and a thank-you is suggested after it.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-md border border-line bg-raised">
          {interviews.map((i) => {
            const who = nameOf(i.contactId);
            return (
              <li key={`${i.on}:${i.time ?? ""}:${i.what}`} className="flex items-center gap-3 px-3 py-2 type-small">
                <time dateTime={i.time ? `${i.on}T${i.time}` : i.on} className="w-36 shrink-0 tabular text-muted">
                  {day(i.on)}
                  {i.time && ` · ${i.time}`}
                </time>
                <span className="min-w-0 flex-1 truncate">
                  {i.what}
                  {who && <span className="text-muted"> with {who}</span>}
                </span>
                <IconButton label={`Remove ${i.what} on ${day(i.on)}`} className="size-7" onClick={() => onUpdate({ interviews: all.filter((x) => x !== i) })}>
                  <X className="size-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2" aria-label="Add an interview">
        <label htmlFor={`${id}-on`} className="grid gap-1 type-meta text-muted">
          Date
          <input id={`${id}-on`} name="on" type="date" required className={input} />
        </label>
        <label htmlFor={`${id}-time`} className="grid gap-1 type-meta text-muted">
          Time
          <input id={`${id}-time`} name="time" type="time" className={input} />
        </label>
        <label htmlFor={`${id}-what`} className="grid min-w-32 flex-1 gap-1 type-meta text-muted">
          Round
          <input id={`${id}-what`} name="what" placeholder="Screen, technical…" className={input} />
        </label>
        {contacts.length > 0 && (
          <label htmlFor={`${id}-person`} className="grid gap-1 type-meta text-muted">
            With
            <Select id={`${id}-person`} name="person" defaultValue="">
              <option value="">No one</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <IconButton type="submit" label="Add interview" className="size-9">
          <Plus className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}
