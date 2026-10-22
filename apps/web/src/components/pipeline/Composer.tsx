import { Handshake, type LucideIcon, Mail, MessageCircle, MessageSquare, Phone, StickyNote, Users } from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { type Activity, activityAt, CAPS, CHANNEL_LABEL, CHANNELS, type Channel, type Contact, dayAfter, type Direction, newId, today } from "../../lib/userState";
import { DateField } from "../DateField";
import { Button, cx, Select } from "../ui";

export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  email: Mail,
  linkedin: MessageSquare,
  whatsapp: MessageCircle,
  call: Phone,
  meeting: Users,
  referral: Handshake,
  note: StickyNote,
};

/** The button: "Log email", "Add note". */
export const LOG_LABEL: Record<Channel, string> = {
  email: "Log email",
  linkedin: "Log LinkedIn message",
  whatsapp: "Log WhatsApp",
  call: "Log call",
  meeting: "Log meeting",
  referral: "Log referral",
  note: "Add note",
};

/** What the live region says after: "Logged email". */
const LOGGED: Record<Channel, string> = {
  email: "Logged email",
  linkedin: "Logged LinkedIn message",
  whatsapp: "Logged WhatsApp",
  call: "Logged call",
  meeting: "Logged meeting",
  referral: "Logged referral",
  note: "Added note",
};

/** "Next follow-up in" choices, in days; 7 is ticked by default for a sent touch. */
export const FOLLOW_UP_CHOICES = [3, 5, 7, 14] as const;
const ADD_PERSON = "__add";

export type ComposerProps = {
  /** The job's people, for the person picker. */
  contacts: readonly Contact[];
  /** Filled in by Log follow-up and Log thank-you: channel, person and a short text; `followUp` marks the touch as a follow-up. */
  initial?: { channel?: Channel; dir?: Direction; contactId?: string; text?: string; followUp?: boolean };
  /** An automatic follow-up date is set: a received touch clears it, and the hint says so. */
  hasFollowUp?: boolean;
  /** False on a Saved job: its date is "Apply by", so a touch neither sets nor clears it, and there's no "Next follow-up in". */
  followUps?: boolean;
  /** Log it: the caller saves the touch (addActivity) with the next follow-up in `followUpDays` days, if any. */
  onLog: (activity: Activity, opts: { followUpDays?: number }) => void;
  /** "Logged email. Next follow-up Oct 28.": for the caller's live region. */
  onAnnounce?: (message: string) => void;
  /** "Add a person" picked in the person picker. */
  onAddPerson?: () => void;
  /** Shows Cancel, which calls this (the Activity's composer folds back to one line). */
  onCancel?: () => void;
  now?: Date;
  className?: string;
};

/** A radio group of buttons with arrow keys (design: Sent / Received). */
function Radios<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (ev: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o, i) => (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA role on purpose: native radios can't look like these buttons
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(ev) => onKey(ev, i)}
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 type-label transition-colors",
            o.value === value ? "border-ink bg-inset text-ink" : "border-line text-muted hover:text-ink",
          )}
        >
          {o.icon && <o.icon className="size-3.5" aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Log a touch on one job (section 6.3 of docs/plans/archive/pipeline-v2.md): a channel, Sent or Received, a
 * person, the day (today or earlier) and a line of text. A sent touch sets the next follow-up; a
 * received one clears it. Ctrl or Cmd + Enter logs. RawJobs sends nothing: this only records it.
 */
export function Composer({ contacts, initial, hasFollowUp, followUps = true, onLog, onAnnounce, onAddPerson, onCancel, now = new Date(), className }: ComposerProps) {
  const id = useId();
  const day = today(now);
  const [channel, setChannel] = useState<Channel>(initial?.channel ?? "email");
  const [dir, setDir] = useState<Direction>(initial?.dir ?? "sent");
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [on, setOn] = useState(day);
  const [text, setText] = useState(initial?.text ?? "");
  const [chase, setChase] = useState(true);
  const [days, setDays] = useState<number>(7);
  const note = channel === "note";
  const sent = !note && dir === "sent";

  const log = () => {
    const words = text.trim().slice(0, CAPS.text);
    const activity: Activity = {
      id: newId(),
      at: activityAt(on > day ? day : on, now),
      channel,
      ...(note ? {} : { dir }),
      ...(contactId ? { contactId } : {}),
      ...(words ? { text: words } : {}),
      ...(initial?.followUp && sent ? { followUp: true as const } : {}),
    };
    const followUpDays = followUps && sent && chase ? days : undefined;
    onLog(activity, { followUpDays });
    const next = followUpDays ? ` Next follow-up ${shortDay(dayAfter(`${day}T12:00:00`, followUpDays))}.` : followUps && !note && dir === "received" && hasFollowUp ? " Follow-up cleared." : "";
    onAnnounce?.(`${LOGGED[channel]}.${next}`);
    setText("");
  };

  return (
    <form
      className={cx("grid gap-3", className)}
      onSubmit={(ev) => {
        ev.preventDefault();
        log();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={`${id}-type`} className="grid gap-1 type-meta text-muted">
          Type
          <Select id={`${id}-type`} value={channel} onChange={(ev) => setChannel(ev.target.value as Channel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </label>
        {!note && (
          <Radios
            label="Sent or received"
            value={dir}
            onChange={setDir}
            options={[
              { value: "sent", label: "Sent" },
              { value: "received", label: "Received" },
            ]}
          />
        )}
        <label htmlFor={`${id}-person`} className="grid gap-1 type-meta text-muted">
          Person
          <Select
            id={`${id}-person`}
            value={contactId}
            onChange={(ev) => {
              if (ev.target.value === ADD_PERSON) onAddPerson?.();
              else setContactId(ev.target.value);
            }}
          >
            <option value="">No one</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {onAddPerson && <option value={ADD_PERSON}>Add a person</option>}
          </Select>
        </label>
        <div className="grid w-40 gap-1 type-meta text-muted">
          <label htmlFor={`${id}-on`}>Date</label>
          <DateField
            id={`${id}-on`}
            label="Date"
            value={on}
            max={day}
            onChange={(d) => setOn(d || day)}
            quick={[
              { label: "Today", value: day },
              { label: "Yesterday", value: dayAfter(`${day}T12:00:00`, -1) },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-text`} className="type-label">
          {note ? "Note" : "What was said"}
        </label>
        <textarea
          id={`${id}-text`}
          value={text}
          maxLength={CAPS.text}
          rows={3}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
              ev.preventDefault();
              log();
            }
          }}
          className="rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {followUps && sent && (
          <label className="inline-flex items-center gap-2 type-small">
            <input type="checkbox" checked={chase} onChange={(ev) => setChase(ev.target.checked)} className="size-4 accent-ink" />
            Next follow-up in
            <Select aria-label="Days until the next follow-up" value={days} disabled={!chase} onChange={(ev) => setDays(Number(ev.target.value))}>
              {FOLLOW_UP_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </Select>
          </label>
        )}
        {followUps && !note && dir === "received" && hasFollowUp && <p className="type-small text-muted">Logging a reply clears the follow-up date.</p>}
        <span className="ml-auto flex gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary">
            {LOG_LABEL[channel]}
          </Button>
        </span>
      </div>
    </form>
  );
}
