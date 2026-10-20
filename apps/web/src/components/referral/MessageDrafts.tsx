import { CircleAlert, Copy, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { aiPrompt, DRAFT_KINDS, DRAFT_LABEL, type DraftInputs, type DraftKind, draftTemplates, NOTE_LIMIT, NOTE_WARN } from "../../lib/referralDrafts";
import { CAPS } from "../../lib/userState";
import { Dialog } from "../Dialog";
import { Tabs } from "../primitives/Tabs";
import { Button, Card, cx, IconButton } from "../ui";

/**
 * Drafts for one person: a connection note, a referral ask and a follow-up, each editable. All three
 * live here, so switching tabs keeps your edits. You copy one and send it yourself; nothing is sent
 * from RawJobs. Mount it when it opens, so every opening starts from fresh drafts.
 */
export function MessageDrafts({ name, inputs, onClose, onMessaged }: { name: string; inputs: DraftInputs; onClose: () => void; onMessaged?: (text: string) => void }) {
  const id = useId();
  const [kind, setKind] = useState<DraftKind>("note");
  const [drafts, setDrafts] = useState(() => draftTemplates(inputs));
  const [said, setSaid] = useState<{ text: string; copied?: boolean; failed?: boolean } | null>(null);
  const text = drafts[kind];

  const copy = async (value: string, done: string, copied: boolean) => {
    const ok = await copyText(value);
    setSaid(ok ? { text: done, copied } : { text: "Couldn't copy. Select the text and press Ctrl+C.", failed: true });
  };
  // Escape closes this dialog only, not the job behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} labelledBy={`${id}-title`} initialFocus="textarea">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops Escape from reaching the page's own shortcut */}
      <div onKeyDown={onKeyDown}>
        <Card className="p-5 shadow-l3 sm:p-6">
          <div className="flex items-start gap-3">
            <h2 id={`${id}-title`} className="min-w-0 flex-1 type-subheading font-semibold">
              Message {name}
            </h2>
            <IconButton label="Close" className="-mr-2 -mt-1" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 type-small text-muted">Edit the draft, copy it, then send it yourself on LinkedIn. RawJobs never sends anything.</p>

          <Tabs
            label="Message"
            className="mt-4"
            items={DRAFT_KINDS.map((k) => ({ id: k, label: DRAFT_LABEL[k] }))}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setSaid(null);
            }}
            idPrefix={`${id}-tab`}
            panelId={`${id}-panel`}
            wrap
          />
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${kind}`} className="mt-3 grid gap-1">
            <label htmlFor={`${id}-text`} className="type-label">
              Your message
            </label>
            <textarea
              id={`${id}-text`}
              value={text}
              maxLength={CAPS.text}
              rows={6}
              onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
              aria-describedby={kind === "note" ? `${id}-count ${id}-limit` : undefined}
              className="rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink"
            />
            {kind === "note" && <NoteCounter n={text.length} id={`${id}-count`} liveId={`${id}-limit`} />}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant={said?.copied ? "outline" : "primary"} onClick={() => void copy(text, "Copied. Paste it into LinkedIn and send it from there.", true)}>
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            {onMessaged && (
              <Button variant={said?.copied ? "primary" : "outline"} onClick={() => onMessaged(text)}>
                Mark as messaged
              </Button>
            )}
          </div>
          <p role="status" className={cx("mt-2 min-h-5 type-small", said?.failed ? "text-danger-text" : "text-muted")}>
            {said?.text}
          </p>

          <div className="mt-3 border-t border-hairline pt-3">
            <Button size="sm" variant="ghost" onClick={() => void copy(aiPrompt(kind, inputs), "Copied the prompt.", false)}>
              Copy a prompt for your own AI
            </Button>
            <p className="mt-1 type-meta text-muted">Paste it into any AI you use. RawJobs doesn't send it anywhere.</p>
          </div>
        </Card>
      </div>
    </Dialog>
  );
}

/**
 * "142 / 200" under the connection note. Not a live region: a separate line announces only when the
 * note crosses into the last 20 characters (181) and past the limit (201).
 */
function NoteCounter({ n, id, liveId }: { n: number; id: string; liveId: string }) {
  const level = n > NOTE_LIMIT ? 2 : n > NOTE_WARN ? 1 : 0;
  const last = useRef(level);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (level > last.current) setAnnounce(level === 2 ? `Over LinkedIn's ${NOTE_LIMIT}-character limit.` : `Close to LinkedIn's ${NOTE_LIMIT}-character limit.`);
    else if (level === 0) setAnnounce("");
    last.current = level;
  }, [level]);
  return (
    <>
      <p id={id} className={cx("flex items-center gap-1 type-meta", level === 2 ? "text-danger-text" : level === 1 ? "text-warning-text" : "text-muted")}>
        {level > 0 && <CircleAlert className="size-3.5 shrink-0" aria-hidden />}
        <span className="tabular">
          {n} / {NOTE_LIMIT}
        </span>
        {level === 1 && <span>· Close to LinkedIn's limit</span>}
        {level === 2 && <span>· {n - NOTE_LIMIT} over LinkedIn's limit</span>}
      </p>
      <p id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
  );
}
