import { Plus, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { dayAfter, type Entry, type EntryPatch, type Interview, today } from "../../lib/userState";
import { DateField, fieldTime, TimeField } from "../DateField";
import { Chip, ChipGroup } from "../primitives";
import { Button, IconButton, Select } from "../ui";

const input = "h-9 min-w-0 rounded-md border border-line bg-raised px-2.5 type-small text-ink placeholder:text-muted";
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const badge = (d: string, part: "month" | "day") => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, part === "month" ? { month: "short" } : { day: "numeric" });

/** The usual rounds, one tap each; Other asks for its name. */
export const ROUNDS = ["Screen", "Hiring manager", "Technical", "Case study", "Panel", "Final"] as const;
const OTHER = "Other";

/**
 * The Interviews section: each round with its day, time and person, soonest first. "Add interview"
 * opens a short form: the round, the day, the time and who with.
 */
export function InterviewsTab({ entry, onUpdate, now = new Date() }: { entry: Entry; onUpdate: (patch: EntryPatch) => void; now?: Date }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const contacts = entry.contacts ?? [];
  const all = entry.interviews ?? [];
  const interviews = [...all].sort((a, b) => `${a.on}${a.time ?? ""}`.localeCompare(`${b.on}${b.time ?? ""}`));
  const nameOf = (cid?: string) => (cid ? (contacts.find((c) => c.id === cid)?.name ?? "Removed person") : undefined);

  return (
    <div className="grid gap-3">
      {interviews.length === 0 ? (
        !adding && <p className="type-small text-muted">No interviews yet. Add each round when it's booked: it shows in Next steps, and a thank-you is suggested after it.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-md border border-line bg-raised">
          {interviews.map((i) => {
            const who = nameOf(i.contactId);
            return (
              <li key={`${i.on}:${i.time ?? ""}:${i.what}`} className="flex items-center gap-3 px-3 py-2 type-small">
                <time dateTime={i.time ? `${i.on}T${i.time}` : i.on} className="grid w-10 shrink-0 rounded-sm border border-line py-1 text-center leading-none">
                  <span className="sr-only">{day(i.on)}</span>
                  <span aria-hidden className="type-meta text-muted">
                    {badge(i.on, "month")}
                  </span>
                  <span aria-hidden className="mt-0.5 tabular font-semibold">
                    {badge(i.on, "day")}
                  </span>
                </time>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{i.what}</span>
                  <span className="truncate type-meta text-muted">
                    {[new Date(`${i.on}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }), i.time && fieldTime(i.time), who && `with ${who}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <IconButton label={`Remove ${i.what} on ${day(i.on)}`} className="size-7" onClick={() => onUpdate({ interviews: all.filter((x) => x !== i) })}>
                  <X className="size-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <AddInterview
          id={id}
          contacts={contacts}
          now={now}
          onCancel={() => setAdding(false)}
          onSave={(next) => {
            onUpdate({ interviews: [...all, next] });
            setAdding(false);
          }}
        />
      ) : (
        <Button size="sm" className="justify-self-start" onClick={() => setAdding(true)}>
          <Plus className="rj-icon" aria-hidden /> Add interview
        </Button>
      )}
    </div>
  );
}

/** The round as one tap, then the day (required), the time and who with. */
function AddInterview({ id, contacts, now, onSave, onCancel }: { id: string; contacts: Entry["contacts"] & {}; now: Date; onSave: (i: Interview) => void; onCancel: () => void }) {
  const [round, setRound] = useState<string>("");
  const [other, setOther] = useState("");
  const [on, setOn] = useState("");
  const [time, setTime] = useState("");
  const [missing, setMissing] = useState(false);
  const start = today(now);
  const plus = (n: number) => dayAfter(`${start}T12:00:00`, n);

  const save = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!on) return setMissing(true);
    const contactId = String(new FormData(ev.currentTarget).get("person") ?? "");
    const what = (round === OTHER ? other.trim() : round) || "Interview";
    onSave({ on, what, ...(time ? { time } : {}), ...(contactId ? { contactId } : {}) });
  };

  return (
    <form onSubmit={save} aria-label="Add an interview" className="grid gap-3 rounded-md border border-line bg-raised p-3">
      <ChipGroup label="Round" className="gap-1.5">
        {[...ROUNDS, OTHER].map((r) => (
          <Chip key={r} pressed={round === r} onClick={() => setRound(round === r ? "" : r)}>
            {r === OTHER ? "Other…" : r}
          </Chip>
        ))}
      </ChipGroup>
      {round === OTHER && (
        <label htmlFor={`${id}-what`} className="grid gap-1 type-meta text-muted">
          Round name
          {/* biome-ignore lint/a11y/noAutofocus: focus moves into the field Other just opened */}
          <input id={`${id}-what`} autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Take-home, presentation…" className={input} />
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1 type-meta text-muted">
          <label htmlFor={`${id}-on`}>Date</label>
          <DateField
            id={`${id}-on`}
            label="Interview date"
            value={on}
            onChange={(d) => {
              setOn(d);
              setMissing(false);
            }}
            quick={[
              { label: "Tomorrow", value: plus(1) },
              { label: "In 3 days", value: plus(3) },
              { label: "Next week", value: plus(7) },
            ]}
          />
          {missing && <span className="text-danger-text">Pick the day of the interview.</span>}
        </div>
        <div className="grid gap-1 type-meta text-muted">
          <label htmlFor={`${id}-time`}>Time</label>
          <TimeField id={`${id}-time`} label="Time" value={time} onChange={setTime} />
        </div>
      </div>
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
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary">
          Save interview
        </Button>
      </div>
    </form>
  );
}
