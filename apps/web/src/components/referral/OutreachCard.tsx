import { Copy, ExternalLink } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { parseHash } from "../../app/route";
import { copyText } from "../../lib/clipboard";
import { draftTemplates } from "../../lib/referralDrafts";
import { profileLink, seePeopleHref } from "../../lib/referralLinks";
import { type CardJob, type LogInput, type LogResult, openBeside, sendLog } from "../../lib/seePeople";
import { useTheme } from "../../lib/theme";
import { CAPS } from "../../lib/userState";
import { Field } from "../primitives/Field";
import { Button, cx } from "../ui";
import { NoteCounter } from "./MessageDrafts";

const BLOCKED = "Your browser blocked the LinkedIn window. Allow pop-ups for RawJobs, or use the search links.";
const BAD_LINK = "Paste a profile link like linkedin.com/in/their-name.";

type Said = { text: string; failed?: boolean };

/**
 * The See people card: the job, "Open LinkedIn beside this", a box to log someone you found and a
 * connection note to copy. It lives in the card's own window (Picture-in-Picture or a popup), so it
 * uses no Toast, Menu or Select: feedback goes in its status line. `win` is that window, for copying.
 */
export function OutreachCard({ job, win, onLog }: { job: CardJob; win: Window; onLog: (p: LogInput) => LogResult | Promise<LogResult> }) {
  const id = useId();
  const [profile, setProfile] = useState("");
  const [first, setFirst] = useState("");
  const [badLink, setBadLink] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);

  const drafts = draftTemplates({ job: { id: job.id, title: job.title, url: job.url }, company: job.company, first: first.trim() || undefined });
  const note = edited ?? drafts.note;

  const openLinkedIn = () => {
    const ok = openBeside(seePeopleHref({ company: job.company, title: job.title }));
    setSaid(ok ? { text: "LinkedIn is open on the left. Log the people you find here." } : { text: BLOCKED, failed: true });
  };
  const copy = async (text: string, done: string) => {
    const ok = await copyText(text, win);
    setSaid(ok ? { text: done } : { text: "Couldn't copy. Select the text and press Ctrl+C.", failed: true });
  };
  const log = async (e: FormEvent) => {
    e.preventDefault();
    const link = profileLink(profile);
    if (!link) return setBadLink(true);
    setBusy(true);
    const r = await onLog({ profile: link, ...(first.trim() ? { first: first.trim() } : {}) });
    setBusy(false);
    setSaid({ text: r.message, failed: !r.ok });
    if (r.ok) setProfile("");
  };

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="type-subheading font-semibold">{job.title || "This job"}</h1>
        <p className="type-small text-muted">{[job.company, job.place].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="space-y-1">
        <Button variant="primary" autoFocus onClick={openLinkedIn}>
          <ExternalLink className="size-4" aria-hidden /> Open LinkedIn beside this
        </Button>
        <p className="type-meta text-muted">Find someone there, then log them below. RawJobs never sends anything.</p>
      </div>

      <form className="space-y-2 border-t border-hairline pt-3" onSubmit={(e) => void log(e)} noValidate>
        <h2 className="type-label">Log this person</h2>
        <Field
          label="Their LinkedIn profile link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="linkedin.com/in/…"
          maxLength={CAPS.linkedin}
          value={profile}
          error={badLink ? BAD_LINK : undefined}
          onChange={(e) => {
            setProfile(e.target.value);
            if (badLink && profileLink(e.target.value)) setBadLink(false);
          }}
          onBlur={() => setBadLink(!!profile.trim() && !profileLink(profile))}
        />
        <Field
          label="Their first name"
          help="Optional. Fills in the note below."
          autoComplete="off"
          maxLength={CAPS.name}
          value={first}
          onChange={(e) => {
            setFirst(e.target.value);
            setEdited(null);
          }}
        />
        <Button type="submit" size="sm" disabled={busy}>
          Log this person
        </Button>
      </form>

      <div className="grid gap-1 border-t border-hairline pt-3">
        <label htmlFor={`${id}-note`} className="type-label">
          Connection note
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          rows={5}
          maxLength={CAPS.text}
          onChange={(e) => setEdited(e.target.value)}
          aria-describedby={`${id}-count ${id}-limit`}
          className="rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink"
        />
        <NoteCounter n={note.length} id={`${id}-count`} liveId={`${id}-limit`} />
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void copy(note, "Copied the note. Paste it into LinkedIn's connection request.")}>
            <Copy className="size-4" aria-hidden /> Copy note
          </Button>
          <Button size="sm" onClick={() => void copy(drafts.ask, "Copied the referral ask. Paste it into a LinkedIn message.")}>
            <Copy className="size-4" aria-hidden /> Copy referral ask
          </Button>
        </div>
      </div>

      <p role="status" className={cx("min-h-5 type-small", said?.failed ? "text-danger-text" : "text-muted")}>
        {said?.text}
      </p>
    </div>
  );
}

function readCard(): CardJob | null {
  const r = parseHash();
  return "card" in r ? r.card : null;
}

/**
 * The card in its own popup ("#card/<jobId>?…"), where Picture-in-Picture isn't available. main.tsx
 * renders only this. People you log go to the RawJobs tab that opened it (lib/seePeople.ts sendLog).
 */
export function CardPage() {
  useTheme();
  const [job, setJob] = useState(readCard);
  useEffect(() => {
    // Another "See people" click reuses this window with a new hash.
    const onHash = () => setJob(readCard());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.close();
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    document.title = job?.company ? `People at ${job.company} · RawJobs` : "RawJobs";
  }, [job?.company]);
  const jobId = job?.id;
  const onLog = useCallback((p: LogInput) => (jobId ? sendLog(jobId, p) : { ok: false, message: "" }), [jobId]);

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      {job ? <OutreachCard key={job.id} job={job} win={window} onLog={onLog} /> : <p className="p-4 type-small text-muted">This card lost its job. Open it again from the job in RawJobs.</p>}
    </main>
  );
}
