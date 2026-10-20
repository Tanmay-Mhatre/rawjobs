import { displayName } from "@rawjobs/core/display-name";
import { CalendarClock, ExternalLink, Plus, UserRound, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type Entry, type EntryPatch, type Interview, newId, OFFER_FIELDS, type Offer, PIPELINE, ROLE_LABEL, STATUS_LABEL, type Status, toContact, today } from "../lib/userState";
import { contactLinks, LINK_REL } from "../lib/contactLinks";
import { Dialog } from "./Dialog";
import { Button, Card, IconButton, Select } from "./ui";

const input = "h-8 min-w-0 rounded-md border border-line bg-raised px-2 type-small text-ink placeholder:text-muted";

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The next interview from today, if any (for the Pipeline card). */
export const nextInterview = (e: Entry, now = new Date()): Interview | undefined => (e.interviews ?? []).filter((i) => i.on >= today(now)).sort((a, b) => a.on.localeCompare(b.on))[0];

/** Interview rounds and the people for one tracked job, each added in one line and removed with ×. */
export function TrackingExtras({ entry, onUpdate }: { entry: Entry; onUpdate: (patch: EntryPatch) => void }) {
  const interviews = [...(entry.interviews ?? [])].sort((a, b) => a.on.localeCompare(b.on));
  const contacts = entry.contacts ?? [];
  const addInterview = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const on = String(f.get("on") ?? "");
    if (!on) return;
    onUpdate({ interviews: [...(entry.interviews ?? []), { on, what: String(f.get("what") ?? "").trim() || "Interview" }] });
    ev.currentTarget.reset();
  };
  const addContact = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    if (!name) return;
    const role = String(f.get("role") ?? "").trim();
    const link = String(f.get("link") ?? "").trim();
    // The free-text role is mapped to a v2 role (text that doesn't map is kept as how you met).
    const person = toContact({ name, role, ...(/^https?:\/\//.test(link) ? { link } : {}) }, newId());
    if (person) onUpdate({ contacts: [...contacts, person] });
    ev.currentTarget.reset();
  };
  return (
    <div className="grid gap-4">
      {entry.status === "offer" || entry.offer ? <OfferFields offer={entry.offer ?? {}} onSave={(offer) => onUpdate({ offer })} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="flex items-center gap-1.5 type-label">
            <CalendarClock className="size-3.5" aria-hidden /> Interviews
          </h4>
          {interviews.length > 0 && (
            <ul className="mt-1 grid gap-1 type-small">
              {interviews.map((i) => (
                <li key={`${i.on}:${i.what}`} className="flex items-center gap-2">
                  <span className="tabular text-muted">{day(i.on)}</span>
                  <span className="min-w-0 flex-1 truncate">{i.what}</span>
                  <IconButton label={`Remove ${i.what} on ${day(i.on)}`} className="size-7" onClick={() => onUpdate({ interviews: (entry.interviews ?? []).filter((x) => x !== i) })}>
                    <X className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addInterview} className="mt-1.5 flex gap-1.5">
            <input name="on" type="date" required aria-label="Interview date" className={input} />
            <input name="what" aria-label="Which round" placeholder="Screen, technical…" className={`${input} flex-1`} />
            <IconButton type="submit" label="Add interview" className="size-8">
              <Plus className="size-4" />
            </IconButton>
          </form>
        </div>
        <div>
          <h4 className="flex items-center gap-1.5 type-label">
            <UserRound className="size-3.5" aria-hidden /> People
          </h4>
          {contacts.length > 0 && (
            <ul className="mt-1 grid gap-1 type-small">
              {contacts.map((c) => {
                // Only checked links: LinkedIn through contactLinks, else a v1 http(s) link.
                const href = contactLinks(c).linkedin ?? (c.link && /^https?:\/\//.test(c.link) ? c.link : undefined);
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {href ? (
                        <a href={href} target="_blank" rel={LINK_REL} className="font-medium hover:underline">
                          {c.name}
                        </a>
                      ) : (
                        <span className="font-medium">{c.name}</span>
                      )}
                      {c.role && <span className="text-muted"> · {c.role === "other" && c.howMet ? c.howMet : ROLE_LABEL[c.role]}</span>}
                    </span>
                    <IconButton label={`Remove ${c.name}`} className="size-7" onClick={() => onUpdate({ contacts: contacts.filter((x) => x !== c) })}>
                      <X className="size-3.5" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
          <form onSubmit={addContact} className="mt-1.5 grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <input name="name" required aria-label="Name" placeholder="Name" className={input} />
            <input name="role" aria-label="Role" placeholder="Recruiter, referrer…" className={input} />
            <IconButton type="submit" label="Add person" className="size-8">
              <Plus className="size-4" />
            </IconButton>
            <input name="link" type="url" aria-label="Profile link (optional)" placeholder="LinkedIn link (optional)" className={`${input} col-span-2`} />
          </form>
        </div>
      </div>
    </div>
  );
}

const OFFER_LABEL: Record<keyof Offer, string> = {
  pay: "Pay",
  bonus: "Bonus",
  equity: "Equity",
  location: "Location / remote",
  start: "Start date",
  deadline: "Answer by",
  note: "Notes",
};
const OFFER_HINT: Partial<Record<keyof Offer, string>> = { pay: "AED 45k a month", bonus: "15% yearly", equity: "0.1% over 4 years", location: "Dubai, hybrid" };
const isDate = (k: keyof Offer) => k === "start" || k === "deadline";

/** The offer's terms, each saved when you leave the field. */
function OfferFields({ offer, onSave }: { offer: Offer; onSave: (offer: Offer) => void }) {
  const save = (k: keyof Offer, v: string) => {
    if ((offer[k] ?? "") === v) return;
    onSave({ ...offer, [k]: v.trim() || undefined });
  };
  return (
    <fieldset className="grid gap-2 rounded-md border border-line p-3">
      <legend className="px-1 type-label">The offer</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OFFER_FIELDS.map((k) => (
          <label key={k} className={`grid gap-1 type-meta text-muted ${k === "note" ? "sm:col-span-2" : ""}`}>
            {OFFER_LABEL[k]}
            <input
              type={isDate(k) ? "date" : "text"}
              defaultValue={offer[k] ?? ""}
              placeholder={OFFER_HINT[k]}
              onBlur={(e) => save(k, e.target.value)}
              onChange={(e) => isDate(k) && save(k, e.target.value)}
              className={input}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Your offers side by side, deadline first. */
export function CompareOffers({ offers, onClose }: { offers: { id: string; entry: Entry }[]; onClose: () => void }) {
  const sorted = [...offers].sort((a, b) => (a.entry.offer?.deadline ?? "9").localeCompare(b.entry.offer?.deadline ?? "9"));
  return (
    <Dialog open onClose={onClose} labelledBy="compare-title" className="max-w-4xl">
      <Card className="p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-3">
          <h2 id="compare-title" className="min-w-0 flex-1 type-subheading font-semibold">
            Compare offers
          </h2>
          <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full type-small">
            <thead>
              <tr className="text-left">
                <th className="w-32" />
                {sorted.map(({ id, entry }) => (
                  <th key={id} scope="col" className="px-2 pb-2 align-bottom font-semibold">
                    {entry.snapshot.title}
                    <span className="block font-normal text-muted">{displayName(entry.snapshot.company)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {OFFER_FIELDS.map((k) => (
                <tr key={k}>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted">
                    {OFFER_LABEL[k]}
                  </th>
                  {sorted.map(({ id, entry }) => {
                    const v = entry.offer?.[k];
                    return (
                      <td key={id} className="px-2 py-1.5 align-top">
                        {v ? isDate(k) ? day(v) : v : <span className="text-muted">–</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Dialog>
  );
}

/** A tracked job that isn't on the Radar (added by hand, or no longer listed): its progress, note, interviews and people. */
export function TrackedJobDialog({ entry, onClose, onUpdate }: { entry: Entry | undefined; onClose: () => void; onUpdate: (patch: EntryPatch) => void }) {
  if (!entry) return null;
  const s = entry.snapshot;
  return (
    <Dialog open onClose={onClose} labelledBy="tracked-title" className="max-w-xl">
      <Card className="grid gap-4 p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="tracked-title" className="type-subheading font-semibold">
              {s.title}
            </h2>
            <p className="type-small text-muted">
              {displayName(s.company)}
              {s.url && (
                <>
                  {" · "}
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    Posting <ExternalLink className="size-3" aria-hidden />
                  </a>
                </>
              )}
            </p>
          </div>
          <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <label htmlFor="tracked-status" className="flex items-center gap-3 type-small font-medium">
          Your progress
          <Select id="tracked-status" value={entry.status ?? ""} onChange={(e) => onUpdate({ status: (e.target.value || undefined) as Status | undefined })}>
            {PIPELINE.map((p) => (
              <option key={p} value={p}>
                {STATUS_LABEL[p]}
              </option>
            ))}
            <option value="">Remove from Pipeline</option>
          </Select>
        </label>
        <label className="grid gap-1 type-label">
          Notes
          <textarea
            key={s.title}
            defaultValue={entry.note ?? ""}
            onBlur={(e) => e.target.value !== (entry.note ?? "") && onUpdate({ note: e.target.value || undefined })}
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-inset p-2.5 type-small font-normal text-ink"
          />
        </label>
        <TrackingExtras entry={entry} onUpdate={onUpdate} />
      </Card>
    </Dialog>
  );
}

/** Track a job RawJobs didn't find (a referral, a recruiter's message): title, company, link. */
export function AddJobDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (job: { title: string; company: string; url: string }, status: Status) => void }) {
  const [status, setStatus] = useState<Status>("applied");
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const title = String(f.get("title") ?? "").trim();
    const company = String(f.get("company") ?? "").trim();
    const url = String(f.get("url") ?? "").trim();
    if (!title || !company) return;
    onAdd({ title, company, url: /^https?:\/\//.test(url) ? url : "" }, status);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} labelledBy="add-job-title" initialFocus="[name=title]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <form onSubmit={submit} className="grid gap-3">
          <div className="flex items-start gap-3">
            <h2 id="add-job-title" className="min-w-0 flex-1 type-subheading font-semibold">
              Track a job
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="-mt-2 type-small text-muted">For a job RawJobs didn't find: a referral, a recruiter's message, a site it doesn't check.</p>
          <label className="grid gap-1 type-label">
            Job title
            <input name="title" required className={`${input} h-9`} />
          </label>
          <label className="grid gap-1 type-label">
            Company
            <input name="company" required className={`${input} h-9`} />
          </label>
          <label className="grid gap-1 type-label">
            Link to the posting (optional)
            <input name="url" type="url" placeholder="https://" className={`${input} h-9`} />
          </label>
          <label htmlFor="add-job-stage" className="flex items-center gap-3 type-label">
            Stage
            <Select id="add-job-stage" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {PIPELINE.map((p) => (
                <option key={p} value={p}>
                  {STATUS_LABEL[p]}
                </option>
              ))}
            </Select>
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Track it
            </Button>
          </div>
        </form>
      </Card>
    </Dialog>
  );
}
