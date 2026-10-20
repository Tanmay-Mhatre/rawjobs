import { PASTE_CAPS, type PasteResult, type PastedPerson, parsePeoplePaste } from "@rawjobs/core/network/paste";
import { type ClipboardEvent, useId, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { introTemplate } from "../../lib/referralDrafts";
import { friendsSearch } from "../../lib/referralLinks";
import { type Contact, newId, type Outreach, toContact } from "../../lib/userState";
import { toast } from "../Toast";
import { Button } from "../ui";

/**
 * What you pasted, per company, in memory only: it survives switching jobs but not a reload, and is
 * never written to storage or sent anywhere.
 */
const pasted = new Map<string, PasteResult>();

/** For tests. */
export function resetPasted() {
  pasted.clear();
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const DEGREE_WORD = { 1: "1st", 2: "2nd" } as const;

/** Adds someone from the paste as To contact; `before` goes at the start of the toast. */
export type AddPasted = (c: Contact, extra: Pick<Outreach, "degree" | "mutual">, before?: string) => void;

type Props = {
  company: string;
  /** Who the results belong to: the company's network key. */
  memoryKey: string;
  title: string;
  /** Names already on this job, so their row says so instead of offering to add them again. */
  onJob: (name: string) => boolean;
  add?: AddPasted;
};

/**
 * "Find friends at {Company}": opens LinkedIn's people search for your 1st and 2nd connections there,
 * then reads the results page you copy and paste back. The paste is read on this computer.
 */
export function FindFriends({ company, memoryKey, title, onJob, add }: Props) {
  const id = useId();
  const [result, setResultState] = useState<PasteResult | undefined>(() => pasted.get(memoryKey));
  const [open, setOpen] = useState(() => pasted.has(memoryKey));
  const [blocked, setBlocked] = useState(false);
  const [text, setText] = useState("");
  const setResult = (r: PasteResult | undefined) => {
    if (r) pasted.set(memoryKey, r);
    else pasted.delete(memoryKey);
    setResultState(r);
  };

  const openSearch = () => {
    // A "noopener" feature makes window.open return null even when the window opens, so a blocked
    // pop-up couldn't be told apart. Open it plainly, then cut the link back to RawJobs at once
    // (the page sends no referrer: index.html has referrer no-referrer).
    const w = window.open(friendsSearch(company), "rawjobs-linkedin");
    if (w) {
      try {
        w.opener = null;
      } catch {
        // already navigated away; nothing to cut
      }
    }
    setBlocked(!w);
    setOpen(true);
  };
  const read = (value: string) => {
    if (!value.trim()) return;
    setResult(parsePeoplePaste(value));
    setText("");
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const value = e.clipboardData.getData("text");
    if (!value.trim()) return;
    e.preventDefault();
    read(value);
  };
  const clear = () => {
    setResult(undefined);
    setText("");
  };

  const key = isMac() ? "Cmd" : "Ctrl";
  return (
    <>
      <Button size="sm" onClick={openSearch}>
        Find friends at {company}
      </Button>
      {open && (
        <div className="basis-full space-y-2">
          {blocked && <p className="type-small text-warning-text">Your browser blocked the LinkedIn window. Allow pop-ups for RawJobs, or use the search links.</p>}
          <label htmlFor={`${id}-paste`} className="block type-label">
            Paste LinkedIn search results
          </label>
          <p id={`${id}-steps`} className="type-small text-muted">
            On LinkedIn, press {key}+A then {key}+C. Come back and paste here.
          </p>
          <textarea
            id={`${id}-paste`}
            value={text}
            maxLength={PASTE_CAPS.chars}
            rows={3}
            aria-describedby={`${id}-steps`}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            className="w-full rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink"
          />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => read(text)}>
              Find my friends
            </Button>
            {(result || text) && (
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
          {result && <Results result={result} company={company} title={title} onJob={onJob} add={add} />}
        </div>
      )}
    </>
  );
}

function Results({ result, company, title, onJob, add }: { result: PasteResult; company: string; title: string; onJob: (name: string) => boolean; add?: AddPasted }) {
  const { people } = result;
  const first = people.filter((p) => p.degree === 1).length;
  const status = people.length
    ? `Found ${people.length} ${people.length === 1 ? "person" : "people"}: ${first} 1st, ${people.length - first} 2nd`
    : result.noEnglishMarkers
      ? "Set LinkedIn to English to use this."
      : "No people found. Only 1st and 2nd connections show here.";
  return (
    <div className="space-y-2">
      <p role="status" className="type-small text-ink">
        {status}
      </p>
      {people.length > 0 && (
        <>
          <ul className="divide-y divide-hairline" aria-label={`People from your search at ${company}`}>
            {people.map((p) => (
              <li key={`${p.name}\n${p.title ?? ""}`} className="py-2 first:pt-0">
                <PastedRow person={p} company={company} title={title} here={onJob(p.name)} add={add} />
              </li>
            ))}
          </ul>
          <p className="type-meta text-muted">Gone when you reload.</p>
        </>
      )}
    </div>
  );
}

function PastedRow({ person, company, title, here, add }: { person: PastedPerson; company: string; title: string; here: boolean; add?: AddPasted }) {
  const [unCopied, setUnCopied] = useState<string | null>(null);
  const contact = () => toContact({ name: person.name, role: "referrer", company }, newId());
  const mutual = person.mutual;
  const addThem = () => {
    const c = contact();
    if (c) add?.(c, { degree: person.degree });
  };
  const askIntro = async () => {
    if (!mutual) return;
    const text = introTemplate({ mutual: mutual.first, first: person.name.split(" ")[0] || person.name, company, title });
    const ok = await copyText(text);
    setUnCopied(ok ? null : text);
    const c = !here && contact();
    if (c) add?.(c, { degree: 2, mutual: mutual.first }, ok ? "Copied the intro message. " : undefined);
    else if (ok) toast({ message: "Copied the intro message" });
  };
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="type-body font-medium text-ink">{person.name}</span>
        <span className="type-meta text-muted">{DEGREE_WORD[person.degree]}</span>
        {here && <span className="type-meta font-medium text-ink">On this job</span>}
      </div>
      {person.title && <p className="type-small text-muted">{person.title}</p>}
      {mutual && <p className="type-small">{mutual.others ? `${mutual.first} and ${mutual.others} other${mutual.others === 1 ? "" : "s"} know them` : `${mutual.first} knows them`}</p>}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {(person.degree === 1 || !mutual) && !here && add && (
          <Button size="sm" onClick={addThem}>
            Add to contacts
          </Button>
        )}
        {person.degree === 2 && mutual && (
          <Button size="sm" onClick={() => void askIntro()}>
            Ask {mutual.first} to introduce you
          </Button>
        )}
      </div>
      {unCopied && (
        <div className="space-y-1">
          <p className="type-small text-warning-text">Couldn't copy. Select the text and press Ctrl+C.</p>
          <p className="select-all rounded-md border border-line bg-raised px-2.5 py-2 type-small text-ink">{unCopied}</p>
        </div>
      )}
    </div>
  );
}
