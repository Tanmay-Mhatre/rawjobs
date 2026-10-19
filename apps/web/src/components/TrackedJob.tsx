import { displayName } from "@rawjobs/core/display-name";
import { CalendarClock, ExternalLink, Plus, UserRound, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type Entry, type EntryPatch, type Interview, PIPELINE, STATUS_LABEL, type Status, today } from "../lib/userState";
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
    onUpdate({ contacts: [...contacts, { name, ...(role ? { role } : {}), ...(/^https?:\/\//.test(link) ? { link } : {}) }] });
    ev.currentTarget.reset();
  };
  return (
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
            {contacts.map((c) => (
              <li key={`${c.name}:${c.link ?? ""}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.link ? (
                    <a href={c.link} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {c.name}
                    </a>
                  ) : (
                    <span className="font-medium">{c.name}</span>
                  )}
                  {c.role && <span className="text-muted"> · {c.role}</span>}
                </span>
                <IconButton label={`Remove ${c.name}`} className="size-7" onClick={() => onUpdate({ contacts: contacts.filter((x) => x !== c) })}>
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
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
