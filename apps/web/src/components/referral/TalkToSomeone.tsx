import { networkKey } from "@rawjobs/core/network/company";
import { type PersonScore, scorePerson } from "@rawjobs/core/network/score";
import { ChevronRight, ExternalLink, Users } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { isAgencyPosting } from "../../lib/agency";
import { LINK_REL } from "../../lib/contactLinks";
import { canRunLocally, type Job, type Profile } from "../../lib/data";
import { companyName } from "../../lib/format";
import { type NetworkMe, type NetworkPersonRow, REFRESH_AFTER_DAYS, setCloseContact, useNetwork, usePeopleAt } from "../../lib/network";
import { coldLinks, profileHref, recruiterLinks, type SearchLink, warmLinks } from "../../lib/referralLinks";
import { CAPS, type Contact, type Entry, type EntryPatch, newId, OUTREACH_LABEL, type Outreach, toContact } from "../../lib/userState";
import { knownPeople } from "../pipeline/detail";
import { usePeople } from "../pipeline/PeopleContext";
import { KnownPicker } from "../pipeline/PeopleTab";
import { toast } from "../Toast";
import { Button, cx } from "../ui";
import { ConnectLinkedIn } from "./ConnectLinkedIn";

/** Rows shown before "Show all". */
export const TOP_PEOPLE = 5;
/** From this many days, the reminder to get a fresh copy turns to warning colour. */
export const STALE_AFTER_DAYS = 60;
const DAY = 86_400_000;

const BAND_CLASS: Record<PersonScore["band"], string> = { high: "text-success-text", medium: "text-ink", low: "text-muted" };

/** Nothing for the first 100 ms, so a quick answer never flashes a loading line. */
function useAfter(on: boolean, ms = 100): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return setLate(false);
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}

type Props = {
  job: Job;
  entry?: Entry;
  profile?: Pick<Profile, "past_employers">;
  /** Changes this job's tracking; without it the section only shows who you know. */
  onUpdate?: (patch: EntryPatch) => void;
  /** Opens Pipeline's People tab for this job, where stages are edited. */
  onOpenPeople?: () => void;
};

/** Adds people to the job's contacts from the section: what a row needs to know and do. */
type Contacts = {
  /** Who on this job came from this connection (by network id or profile link), and their referral stage. */
  onJob: (person: NetworkPersonRow) => { contact: Contact; outreach?: Outreach } | undefined;
  add?: (c: Contact, networkId?: string) => void;
  onOpenPeople?: () => void;
};

/** "Talk to someone who works here": who you know at the job's company, ranked, and searches to find more. Hidden on Not interested jobs. */
export function TalkToSomeone(p: Props) {
  if (p.entry?.status === "dismissed") return null;
  return <Section {...p} />;
}

function Section({ job, entry, profile, onUpdate, onOpenPeople }: Props) {
  const company = companyName(job.company);
  const agency = isAgencyPosting(job);
  const network = useNetwork();
  const info = network?.state === "ready" ? network.value : null;
  const status = info?.status;
  const connected = !!status?.connected;
  const people = usePeopleAt(job.company, connected && !agency);
  const [connecting, setConnecting] = useState(false);
  const loading = useAfter(network?.state === "loading" || people?.state === "loading");
  const headingId = `talk-${job.id}`;

  const tracking = usePeople();
  const contacts = entry?.contacts ?? [];
  const full = contacts.length >= CAPS.contacts;
  const key = networkKey(job.company);
  const known = useMemo(() => (tracking ? knownPeople(tracking.state, job.id) : []), [tracking, job.id]);
  const alsoHere = key ? known.filter((c) => networkKey(c.company) === key) : [];

  /**
   * Add someone to this job's contacts, To contact on LinkedIn. The first person on a job you
   * haven't saved saves it too; Undo puts back what was there.
   */
  const add =
    onUpdate &&
    ((c: Contact, networkId?: string) => {
      const saving = !entry?.status;
      const ask: Outreach = { stage: "to-contact", via: "linkedin", at: new Date().toISOString(), ...(networkId ? { networkId } : {}) };
      onUpdate({ ...(saving ? { status: "saved" as const } : {}), contacts: [...contacts, c], outreach: { ...entry?.outreach, [c.id]: ask } });
      toast({
        message: saving ? `Saved this job and added ${c.name}` : `Added ${c.name} to this job`,
        actionLabel: "Undo",
        onAction: () => onUpdate({ ...(saving ? { status: entry?.status } : {}), contacts: entry?.contacts, outreach: entry?.outreach }),
      });
    });
  const rowContacts: Contacts = {
    onJob: (person) => {
      const href = profileHref(person.url);
      const contact = contacts.find((c) => entry?.outreach?.[c.id]?.networkId === person.id || (!!href && c.linkedin === href));
      return contact && { contact, outreach: entry?.outreach?.[contact.id] };
    },
    add:
      add && !full
        ? (c, networkId) => {
            // Someone already on another job (same profile) is the same person here.
            const same = c.linkedin ? known.find((k) => k.linkedin === c.linkedin) : undefined;
            add(same ?? c, networkId);
          }
        : undefined,
    onOpenPeople,
  };

  const me = info?.me ?? null;
  const links = useMemo(() => searchLinks({ company, title: job.title, me, pastEmployers: profile?.past_employers ?? [], agency }), [company, job.title, me, profile?.past_employers, agency]);

  let body: ReactNode = null;
  if (agency) {
    body = <p className="type-small text-muted">A recruitment agency posted this and may not name the employer. Ask the agency's recruiter which company it is, then look for people there.</p>;
  } else if (canRunLocally && status && !status.connected) {
    body = status.newer ? (
      <p className="type-small text-warning-text">Update RawJobs to read your connections.</p>
    ) : (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 type-small text-muted">Connect LinkedIn to see who you already know at {company}. Your connections stay on this computer.</p>
        <Button size="sm" onClick={() => setConnecting(true)}>
          <Users className="size-4" aria-hidden /> Connect LinkedIn
        </Button>
      </div>
    );
  } else if (status?.connected) {
    const stale = status.ageDays >= REFRESH_AFTER_DAYS && (
      <p className={cx("type-small", status.ageDays >= STALE_AFTER_DAYS ? "text-warning-text" : "text-muted")}>
        Connections imported {status.ageDays} days ago.{" "}
        <button type="button" className="font-medium underline underline-offset-2 hover:text-ink" onClick={() => setConnecting(true)}>
          Get a fresh copy
        </button>
      </p>
    );
    body = (
      <>
        {stale}
        {people?.state === "ready" &&
          (people.value.people.length ? (
            <PeopleList people={people.value.people} loose={people.value.how === "prefix"} job={job} me={me} contacts={rowContacts} />
          ) : (
            <p className="type-small text-muted">You don't know anyone at {company} on LinkedIn yet. These searches find people one step away.</p>
          ))}
        {people?.state === "error" && <p className="type-small text-muted">Couldn't look up your connections just now.</p>}
      </>
    );
  }

  return (
    <section className="rj-drawer__section" aria-labelledby={headingId}>
      <h3 id={headingId} className="rj-h">
        Talk to someone who works here
      </h3>
      {loading && (
        <p role="status" className="type-small text-muted">
          Looking for people you know…
        </p>
      )}
      {body}
      {!agency && add && !full && alsoHere.length > 0 && <KnownPicker known={alsoHere} onPick={(c) => add(c)} />}
      {links.length > 0 && <MoreWaysIn links={links} />}
      {canRunLocally && <ConnectLinkedIn open={connecting} onClose={() => setConnecting(false)} />}
    </section>
  );
}

function searchLinks({ company, title, me, pastEmployers, agency }: { company: string; title: string; me: NetworkMe | null; pastEmployers: readonly string[]; agency: boolean }): SearchLink[] {
  if (agency) return recruiterLinks(company);
  const past = [...(me?.positions ?? []).filter((p) => p.to).map((p) => p.company), ...pastEmployers];
  const inputs = { company, title, schools: me?.schools.map((s) => s.name) ?? [], pastEmployers: past };
  return [...warmLinks(inputs), ...coldLinks(inputs)];
}

function MoreWaysIn({ links }: { links: SearchLink[] }) {
  return (
    <details className="group/fold">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 type-label [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted transition-transform duration-150 group-open/fold:rotate-90" aria-hidden />
        More ways in
      </summary>
      <ul className="mt-1 space-y-1 type-small">
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.href} target="_blank" rel={LINK_REL} className="inline-flex items-center gap-1 text-ink underline underline-offset-2 hover:text-muted">
              {l.label} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 type-meta text-muted">These open LinkedIn or Blind in your browser. RawJobs sends nothing to them.</p>
    </details>
  );
}

type Ranked = { person: NetworkPersonRow; score: PersonScore };

function PeopleList({ people, loose, job, me, contacts }: { people: NetworkPersonRow[]; loose: boolean; job: Job; me: NetworkMe | null; contacts: Contacts }) {
  const [all, setAll] = useState(false);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const focusNext = useRef(false);
  const ranked = useMemo<Ranked[]>(() => {
    const now = new Date();
    return people
      .map((person) => {
        const connectedOn = person.connectedDays === undefined ? undefined : new Date(now.getTime() - person.connectedDays * DAY).toISOString().slice(0, 10);
        const score = scorePerson(
          { degree: 1, position: person.position, connectedOn, friend: person.friend },
          { title: job.title, seniority: job.seniority },
          { positions: me?.positions ?? [] },
          now,
        );
        return { person, score };
      })
      .sort((a, b) => b.score.total - a.score.total || (b.person.connectedDays ?? 0) - (a.person.connectedDays ?? 0));
  }, [people, job.title, job.seniority, me]);
  useEffect(() => {
    if (!all || !focusNext.current) return;
    focusNext.current = false;
    rows.current[TOP_PEOPLE]?.focus();
  }, [all]);

  const shown = all ? ranked : ranked.slice(0, TOP_PEOPLE);
  return (
    <>
      <ul className="divide-y divide-hairline" aria-label={`People you know at ${companyName(job.company)}`}>
        {shown.map((r, i) => (
          <li
            key={r.person.id}
            ref={(el) => {
              rows.current[i] = el;
            }}
            tabIndex={-1}
            className="py-2 first:pt-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <PersonRow {...r} loose={loose} contacts={contacts} />
          </li>
        ))}
      </ul>
      {!all && ranked.length > TOP_PEOPLE && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              focusNext.current = true;
              setAll(true);
            }}
          >
            Show all {ranked.length}
          </Button>
        </div>
      )}
    </>
  );
}

function PersonRow({ person, score, loose, contacts }: Ranked & { loose: boolean; contacts: Contacts }) {
  const name = `${person.first} ${person.last}`.trim();
  const href = profileHref(person.url);
  const here = contacts.onJob(person);
  const addThem = () => {
    const c = toContact({ name, role: "referrer", company: person.company, linkedin: href }, newId());
    if (c) contacts.add?.(c, person.id);
  };
  const toggle = async () => {
    const ok = await setCloseContact(person.id, !person.friend);
    if (!ok) toast({ message: "Couldn't save that. Check that RawJobs is running, then try again." });
  };
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {href ? (
          <a href={href} target="_blank" rel={LINK_REL} className="type-body font-medium text-ink underline-offset-2 hover:underline">
            {name}
          </a>
        ) : (
          <span className="type-body font-medium text-ink">{name}</span>
        )}
        <span className={cx("type-meta", BAND_CLASS[score.band])}>Likely to help: {score.band}</span>
        {here &&
          (contacts.onOpenPeople ? (
            <button type="button" className="type-meta font-medium text-ink underline underline-offset-2 hover:text-muted" onClick={contacts.onOpenPeople}>
              {onJobLabel(here.outreach)}
            </button>
          ) : (
            <span className="type-meta font-medium text-ink">{onJobLabel(here.outreach)}</span>
          ))}
      </div>
      {(person.position || (loose && person.company)) && (
        <p className="type-small text-muted">
          {person.position}
          {loose && person.company && `${person.position ? " · " : ""}Works at ${person.company}`}
        </p>
      )}
      {score.why && <p className="type-small">{score.why}.</p>}
      <details className="group/more">
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 type-meta text-muted hover:text-ink [&::-webkit-details-marker]:hidden" aria-label={`More about ${name}`}>
          <ChevronRight className="size-3.5 transition-transform duration-150 group-open/more:rotate-90" aria-hidden />
          More
        </summary>
        <div className="space-y-2 pb-1 pl-5">
          <div>
            <p className="type-label">How this is worked out</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 type-small">
              {score.points.map((pt) => (
                <div key={pt.id} className="contents">
                  <dt className="tabular text-ink">+{pt.points}</dt>
                  <dd className="text-muted">{pt.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 type-meta text-muted">{score.total} in all. 60 or more is high, 35 to 59 medium, under 35 low.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {!here && contacts.add && (
              <Button size="sm" onClick={addThem}>
                Add to contacts
              </Button>
            )}
            <Button size="sm" aria-pressed={person.friend} aria-label={`Mark ${name} as a close contact`} onClick={() => void toggle()}>
              Close contact
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

/** "On this job: Messaged": the stage is edited in Pipeline's People tab, never here. */
const onJobLabel = (o: Outreach | undefined) => (o ? `On this job: ${OUTREACH_LABEL[o.stage]}` : "On this job");
