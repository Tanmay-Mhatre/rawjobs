import { Copy, ExternalLink, Mail, MessageCircle, Pencil, Phone, Plus, UserRound } from "lucide-react";
import { type ClipboardEvent, type FormEvent, type ReactNode, useId, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { contactLinks, LINK_REL, linkedInUrl } from "../../lib/contactLinks";
import { timeAgo } from "../../lib/format";
import { CAPS, type Contact, CONTACT_ROLES, type ContactRole, type Entry, type EntryPatch, newId, ROLE_LABEL, toContact } from "../../lib/userState";
import { buttonClass } from "../primitives";
import { toast } from "../Toast";
import { Button, cx, Select } from "../ui";
import { contactText, knownPeople, pasteField, touchLine } from "./detail";
import { usePeople } from "./PeopleContext";

const input = "h-9 min-w-0 rounded-md border border-line bg-raised px-2.5 type-small text-ink placeholder:text-muted";

/** The role as a small chip; "Other" shows how you met when there's no other word for it. */
export function RoleChip({ c }: { c: Contact }) {
  if (!c.role) return null;
  return <span className="rounded-sm border border-line px-1.5 type-meta text-muted">{c.role === "other" && c.howMet && c.howMet.length <= 30 ? c.howMet : ROLE_LABEL[c.role]}</span>;
}

/**
 * The People tab: one card per person with one-click links (built only by contactLinks), how you've
 * been in touch, and edit and remove; then "Add a person" and "Add someone you already know".
 */
export function PeopleTab({ jobId, entry, onUpdate, adding, onAdding }: { jobId: string; entry: Entry; onUpdate: (patch: EntryPatch) => void; adding: boolean; onAdding: (on: boolean) => void }) {
  const people = usePeople();
  const contacts = entry.contacts ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const known = people ? knownPeople(people.state, jobId) : [];
  const full = contacts.length >= CAPS.contacts;

  const save = (c: Contact) => {
    // The same person on other jobs (same id) gets the edit too.
    if (people && contacts.some((x) => x.id === c.id)) people.updateContact(c);
    else onUpdate({ contacts: contacts.some((x) => x.id === c.id) ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c] });
  };

  return (
    <div className="grid gap-3">
      {contacts.length === 0 && !adding && (
        <div className="grid justify-items-start gap-2 rounded-md border border-dashed border-line p-4">
          <p className="type-small text-muted">No people on this job yet. Add the recruiter, the hiring manager or whoever referred you, to reach them in one click.</p>
          <Button size="sm" onClick={() => onAdding(true)}>
            <Plus className="rj-icon" aria-hidden /> Add a person
          </Button>
        </div>
      )}
      {contacts.length > 0 && (
        <ul className="grid gap-2">
          {contacts.map((c) =>
            editing === c.id ? (
              <li key={c.id}>
                <PersonForm
                  initial={c}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => {
                    save(next);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <PersonCard
                key={c.id}
                c={c}
                touches={touchLine(entry, c.id, (iso) => timeAgo(iso))}
                onEdit={() => setEditing(c.id)}
                onRemove={() => {
                  onUpdate({ contacts: contacts.filter((x) => x.id !== c.id) });
                  toast({ message: `Removed ${c.name} from this job`, actionLabel: "Undo", onAction: () => onUpdate({ contacts }) });
                }}
              />
            ),
          )}
        </ul>
      )}
      {adding ? (
        <PersonForm
          onCancel={() => onAdding(false)}
          onSave={(c) => {
            save(c);
            onAdding(false);
          }}
        />
      ) : (
        contacts.length > 0 &&
        !full && (
          <div>
            <Button size="sm" onClick={() => onAdding(true)}>
              <Plus className="rj-icon" aria-hidden /> Add a person
            </Button>
          </div>
        )
      )}
      {known.length > 0 && !full && <KnownPicker known={known} onPick={(c) => onUpdate({ contacts: [...contacts, c] })} />}
    </div>
  );
}

function KnownPicker({ known, onPick }: { known: Contact[]; onPick: (c: Contact) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-wrap items-center gap-2 type-small text-muted">
      Add someone you already know
      <Select
        id={id}
        value=""
        onChange={(e) => {
          const c = known.find((k) => k.id === e.target.value);
          if (c) onPick(c);
        }}
      >
        <option value="">Pick a person</option>
        {known.map((c) => (
          <option key={c.id} value={c.id}>
            {c.company ? `${c.name}, ${c.company}` : c.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function PersonCard({ c, touches, onEdit, onRemove }: { c: Contact; touches: string; onEdit: () => void; onRemove: () => void }) {
  const links = contactLinks(c);
  const copy = async () => {
    if (await copyText(contactText(c))) toast({ message: `Copied ${c.name}'s details` });
  };
  const link = (href: string, label: string, icon: ReactNode, external?: boolean) => (
    <a href={href} className={buttonClass("secondary", "sm")} {...(external ? { target: "_blank", rel: LINK_REL } : { rel: LINK_REL })}>
      {icon}
      {label}
    </a>
  );
  return (
    <li className="grid gap-2 rounded-md border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <UserRound className="rj-icon text-muted" aria-hidden />
        <span className="font-medium">{c.name}</span>
        <RoleChip c={c} />
        {c.company && <span className="type-small text-muted">{c.company}</span>}
      </div>
      {(c.email || c.phone || links.linkedin) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 type-small">
          {c.email && (
            <>
              <dt className="text-muted">Email</dt>
              <dd className="min-w-0 truncate">{c.email}</dd>
            </>
          )}
          {c.phone && (
            <>
              <dt className="text-muted">Phone</dt>
              <dd className="tabular">
                {c.phone}
                {links.whatsapp && <span className="text-muted"> · on WhatsApp</span>}
              </dd>
            </>
          )}
          {links.linkedin && (
            <>
              <dt className="text-muted">LinkedIn</dt>
              <dd className="min-w-0 truncate font-mono type-meta">{links.linkedin.replace(/^https:\/\/(www\.)?/, "")}</dd>
            </>
          )}
        </dl>
      )}
      {links.needsCountryCode && <p className="type-small text-warning-text">Add the country code to use WhatsApp.</p>}
      <p className="type-meta text-muted">{touches}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {links.email && link(links.email, "Email", <Mail className="rj-icon" aria-hidden />)}
        {links.whatsapp && link(links.whatsapp, "WhatsApp", <MessageCircle className="rj-icon" aria-hidden />, true)}
        {links.call && link(links.call, "Call", <Phone className="rj-icon" aria-hidden />)}
        {links.linkedin && link(links.linkedin, "LinkedIn", <ExternalLink className="rj-icon" aria-hidden />, true)}
        <Button size="sm" variant="ghost" onClick={() => void copy()}>
          <Copy className="rj-icon" aria-hidden /> Copy
        </Button>
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${c.name}`}>
            <Pencil className="rj-icon" aria-hidden /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${c.name} from this job`}>
            Remove
          </Button>
        </span>
      </div>
    </li>
  );
}

type Draft = { name: string; role: ContactRole | ""; company: string; email: string; phone: string; whatsapp: boolean; linkedin: string; howMet: string };
const draftOf = (c?: Contact): Draft => ({
  name: c?.name ?? "",
  role: c?.role ?? "",
  company: c?.company ?? "",
  email: c?.email ?? "",
  phone: c?.phone ?? "",
  whatsapp: !!c?.whatsapp,
  linkedin: c?.linkedin ?? c?.link ?? "",
  howMet: c?.howMet ?? "",
});

/**
 * Add or edit a person. Pasting a LinkedIn URL, an email address or a phone number anywhere in the
 * form puts it in its own field.
 */
export function PersonForm({ initial, onSave, onCancel }: { initial?: Contact; onSave: (c: Contact) => void; onCancel: () => void }) {
  const id = useId();
  const [d, setD] = useState<Draft>(() => draftOf(initial));
  const [linkError, setLinkError] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const needsCode = !!contactLinks({ phone: d.phone, whatsapp: d.whatsapp }).needsCountryCode;

  const onPaste = (ev: ClipboardEvent<HTMLFormElement>) => {
    const hit = pasteField(ev.clipboardData.getData("text"));
    const target = (ev.target as HTMLElement).getAttribute?.("name");
    if (!hit || target === hit.field) return;
    ev.preventDefault();
    set(hit.field, hit.value);
  };

  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const raw = d.linkedin.trim();
    const url = linkedInUrl(raw) ?? pasteField(raw)?.value;
    const kept = !!raw && raw === draftOf(initial).linkedin;
    if (raw && !linkedInUrl(url) && !kept) {
      setLinkError("Use a LinkedIn profile link, like https://www.linkedin.com/in/your-name.");
      return;
    }
    // `link` mirrors LinkedIn so older versions of RawJobs still show it. An older link that isn't
    // LinkedIn (a portfolio, say) is kept as it was while you leave the field alone.
    const link = linkedInUrl(url) ?? (kept ? initial?.link : undefined);
    const c = toContact({ ...d, role: d.role || undefined, linkedin: linkedInUrl(url), link, whatsapp: d.whatsapp }, initial?.id ?? newId());
    if (c) onSave(c);
  };

  const field = (k: "company" | "email" | "phone" | "linkedin" | "howMet", label: string, type: string, max: number, hint?: string) => (
    <label htmlFor={`${id}-${k}`} className={cx("grid gap-1 type-label", k === "howMet" && "sm:col-span-2")}>
      {label}
      <input
        id={`${id}-${k}`}
        name={k}
        type={type}
        value={d[k]}
        maxLength={max}
        placeholder={hint}
        aria-invalid={(k === "linkedin" && !!linkError) || undefined}
        aria-describedby={k === "linkedin" && linkError ? `${id}-linkedin-error` : undefined}
        onChange={(e) => {
          set(k, e.target.value);
          if (k === "linkedin") setLinkError("");
        }}
        className={input}
      />
      {k === "linkedin" && linkError && (
        <span id={`${id}-linkedin-error`} className="type-small font-normal text-danger-text">
          {linkError}
        </span>
      )}
    </label>
  );

  return (
    <form onSubmit={submit} onPaste={onPaste} className="grid gap-3 rounded-md border border-line bg-raised p-3" aria-label={initial ? `Edit ${initial.name}` : "Add a person"}>
      <p className="type-small text-muted">Paste a LinkedIn link, an email address or a phone number and it goes in the right field.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-name`} className="grid gap-1 type-label">
          Name
          {/* biome-ignore lint/a11y/noAutofocus: focus moves into the form that was just opened */}
          <input id={`${id}-name`} name="name" required autoFocus value={d.name} maxLength={CAPS.name} onChange={(e) => set("name", e.target.value)} className={input} />
        </label>
        <label htmlFor={`${id}-role`} className="grid gap-1 type-label">
          Role
          <Select id={`${id}-role`} value={d.role} onChange={(e) => set("role", e.target.value as ContactRole | "")}>
            <option value="">Not set</option>
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </label>
        {field("company", "Company or agency", "text", CAPS.company)}
        {field("email", "Email", "email", CAPS.email)}
        <div className="grid gap-1">
          {field("phone", "Phone", "tel", CAPS.phone, "+971 50 123 4567")}
          <label className="inline-flex items-center gap-2 type-small">
            <input type="checkbox" checked={d.whatsapp} onChange={(e) => set("whatsapp", e.target.checked)} className="size-4 accent-ink" />
            On WhatsApp
          </label>
          {needsCode && <p className="type-small text-warning-text">Add the country code to use WhatsApp.</p>}
        </div>
        {field("linkedin", "LinkedIn", "text", CAPS.linkedin, "https://www.linkedin.com/in/…")}
        {field("howMet", "How you met", "text", CAPS.howMet)}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {initial ? "Save person" : "Add person"}
        </Button>
      </div>
    </form>
  );
}
