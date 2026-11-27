import { FileText, StickyNote } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Job } from "../../lib/data";
import { CLOSED_AS, CLOSED_AS_COMMON, type Entry, type EntryPatch, dayAfter, followUpDue, hadOffer, isActive, PIPELINE, STATUS_LABEL, type Status, stageSince, statusLabel } from "../../lib/userState";
import { DateField } from "../DateField";
import { ReasonPicker } from "../NotForMe";
import { Button } from "../primitives";
import { JobTracking } from "../pipeline/JobTracking";
import { OfferFields } from "../TrackedJob";
import { cx, Select } from "../ui";

/** The progress dropdown's value for an entry: its status, or "rejected:<how it ended>" for a closed job. */
export const progressValue = (e: Entry | undefined) => (e?.status === "rejected" ? `rejected:${e.closedAs ?? "rejected"}` : (e?.status ?? ""));

const shortDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Where a tracked job stands, with dates: "Saved Oct 15 › Applied Oct 16", then, in an active stage, when to
 * follow up, or apply by while saved (changeable, amber once it's due).
 */
export function ProgressLine({ entry, id, onUpdate }: { entry: Entry; id: string; onUpdate: (patch: EntryPatch) => void }) {
  // Only the steps still standing: a status set and later cleared drops out of the line.
  const steps = (entry.history ?? []).filter((h): h is { status: Status; at: string } => h.status !== null).slice(-6);
  const since = entry.status && entry.status !== "dismissed" ? stageSince(entry) : undefined;
  const due = followUpDue(entry);
  const active = isActive(entry.status);
  if (!steps.length && !active) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 type-small text-muted">
      {steps.length > 0 && (
        <p>
          {steps.map((h, i) => (
            <Fragment key={h.at}>
              {i > 0 && <span aria-hidden> › </span>}
              {statusLabel({ status: h.status, closedAs: h.status === entry.status ? entry.closedAs : undefined })} {shortDay(h.at)}
            </Fragment>
          ))}
        </p>
      )}
      {since && (
        // Tracked late (you applied last week): set the real date so the timeline and follow-ups count from it.
        <span className="flex items-center gap-2">
          <label htmlFor={`${id}-since`}>{statusLabel(entry)} on</label>
          <DateField
            id={`${id}-since`}
            label={`${statusLabel(entry)} on`}
            value={dayAfter(since, 0)}
            max={dayAfter(new Date().toISOString(), 0)}
            onChange={(d) => d && onUpdate({ since: d })}
            className="h-8 w-40"
          />
        </span>
      )}
      {active && (
        <span className={cx("flex items-center gap-2", due && "font-medium text-warning-text")}>
          <label htmlFor={id}>{entry.status === "saved" ? (due ? "Apply now" : "Apply by") : due ? "Follow up now" : "Follow up on"}</label>
          <DateField
            id={id}
            label={entry.status === "saved" ? "Apply by" : "Follow up on"}
            value={entry.followUp ?? ""}
            clearable
            placeholder="No date"
            onChange={(d) => onUpdate({ followUp: d || undefined })}
            className="h-8 w-40"
          />
        </span>
      )}
    </div>
  );
}

/** Which CV you sent: folded to a small button until there is one, saved on blur. */
export function CvField({ id, cv, onSave }: { id: string; cv: string; onSave: (cv: string) => void }) {
  const [open, setOpen] = useState(!!cv);
  if (!open)
    return (
      <Button size="sm" variant="quiet" icon={<FileText className="rj-icon" />} onClick={() => setOpen(true)}>
        CV version sent
      </Button>
    );
  return (
    <label htmlFor={id} className="flex items-center gap-2 type-small text-muted">
      CV version sent
      <input
        id={id}
        // Opened from "CV version sent": straight into typing.
        // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened, as the pattern expects
        autoFocus={!cv}
        defaultValue={cv}
        onBlur={(e) => e.target.value.trim() !== cv && onSave(e.target.value.trim())}
        placeholder="Fintech PM v3"
        className="h-8 w-40 rounded-md border border-line bg-inset px-2 type-small text-ink placeholder:text-muted"
      />
    </label>
  );
}

/**
 * Notes for one job. Saved on blur, and also when the field goes away (Escape closes the drawer while typing),
 * so nothing typed is lost.
 */
export function NotesField({ id, note, onSave }: { id: string; note: string; onSave: (note: string) => void }) {
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  // Kept after each render (not during it), for handlers and effects that run later.
  useLayoutEffect(() => {
    save.current = onSave;
  });
  const flush = () => {
    if (pending.current !== null && pending.current !== note) save.current(pending.current);
    pending.current = null;
  };
  const flushRef = useRef(flush);
  // Kept after each render (not during it), for handlers and effects that run later.
  useLayoutEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);
  // Folded to one small button until there's a note, so the description starts higher.
  const [open, setOpen] = useState(!!note);
  if (!open)
    return (
      <div>
        <Button size="sm" variant="quiet" icon={<StickyNote className="rj-icon" />} onClick={() => setOpen(true)}>
          Add a note
        </Button>
      </div>
    );
  return (
    <div className="grid basis-full gap-1">
      <label htmlFor={id} className="type-label">
        Notes
      </label>
      <textarea
        id={id}
        // Opened from "Add a note": straight into typing.
        // biome-ignore lint/a11y/noAutofocus: focus moves into what was just opened (a menu, a dialog field), as the pattern expects
        autoFocus={!note}
        defaultValue={note}
        onChange={(e) => (pending.current = e.target.value)}
        onBlur={flush}
        placeholder="Referral, recruiter name, follow-up date…"
        rows={2}
        className="w-full resize-y rounded-md border border-line bg-inset p-2.5 type-small placeholder:text-muted"
      />
    </div>
  );
}

/** Tracked (or Not interested): the one place to set any status, with notes or CV, dates, offer and the tracking tabs. */
export function YourProgress(p: {
  job: Job;
  entry?: Entry;
  /** On the board (any stage, Closed too). */
  tracked: boolean;
  /** Bumped by "On this job: Messaged" to open the People tab. */
  openPeople: number;
  onUpdate: (patch: EntryPatch) => void;
  /** The progress dropdown's value: a status, or "rejected:<how it ended>". */
  onProgress: (value: string) => void;
}) {
  const { job, entry, tracked, openPeople } = p;
  const status = entry?.status;
  return (
    <section className="rj-drawer__section">
      {/* The one place to set any status; Save and Not interested (More) in the foot are shortcuts. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={`status-${job.id}`} className="rj-sec-h">
          Your progress
        </label>
        <Select id={`status-${job.id}`} value={progressValue(entry)} onChange={(e) => p.onProgress(e.target.value)}>
          <option value="">Not tracked</option>
          {PIPELINE.filter((s) => s !== "rejected").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
          {(hadOffer(entry) ? [...CLOSED_AS_COMMON, "accepted" as const] : CLOSED_AS_COMMON).map((c) => (
            <option key={c} value={`rejected:${c}`}>
              Closed: {CLOSED_AS[c].toLowerCase()}
            </option>
          ))}
          <option value="dismissed">{STATUS_LABEL.dismissed}</option>
        </Select>
        {/* Tracked: notes are logged in Activity (an older note shows there too). */}
        {!tracked && <NotesField key={job.id} id={`notes-${job.id}`} note={entry?.note ?? ""} onSave={(note) => p.onUpdate({ note: note || undefined })} />}
        {/* Which CV went out only matters once you've applied. */}
        {((tracked && status !== "saved") || entry?.cv) && <CvField key={`cv:${job.id}`} id={`cv-${job.id}`} cv={entry?.cv ?? ""} onSave={(cv) => p.onUpdate({ cv: cv || undefined })} />}
      </div>
      {entry && <ProgressLine entry={entry} onUpdate={p.onUpdate} id={`follow-${job.id}`} />}
      {tracked && entry && (entry.status === "offer" || entry.offer) && <OfferFields key={`offer:${job.id}`} offer={entry.offer ?? {}} onSave={(offer) => p.onUpdate({ offer })} />}
      {tracked && entry && <JobTracking key={openPeople} jobId={job.id} entry={entry} title={job.title} foundAt={job.firstSeen} onUpdate={p.onUpdate} initialTab={openPeople ? "people" : undefined} />}
      {status === "dismissed" && <ReasonPicker key={`why:${job.id}`} job={job} label="Why not? Optional." live />}
    </section>
  );
}
