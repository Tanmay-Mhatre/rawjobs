/**
 * Message drafts for asking someone about a job (docs/plans/referral-finder.md, sections 6.H and 7).
 * Pure: the dialog fills them in, you edit and copy them. Nothing is ever sent from RawJobs.
 */
import { safeUrl } from "@rawjobs/core/text";

export const DRAFT_KINDS = ["note", "ask", "follow"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const DRAFT_LABEL: Record<DraftKind, string> = { note: "Connection note", ask: "Ask for a referral", follow: "Follow up" };

/** LinkedIn's limit for the note sent with a connection request. */
export const NOTE_LIMIT = 200;
/** Past this many characters the counter warns that the note is close to the limit. */
export const NOTE_WARN = 180;

export type DraftInputs = {
  job: { id: string; title: string; url?: string };
  /** The company's display name. */
  company: string;
  /** The person's first name and position, when known. */
  first?: string;
  position?: string;
  /** What you'd say about yourself ("payments and risk"); the line goes when there's none. */
  background?: string;
};

/** The job's own id from its RawJobs id ("{ats}:{slug}:{atsJobId}"), else from its link. */
export function jobIdOf(job: { id: string; url?: string }): string | undefined {
  const plain = (s: string | null | undefined) => (s && /^[\w.-]{1,40}$/.test(s) && /\d/.test(s) ? s : undefined);
  const fromId = plain(job.id.split(":").slice(2).join(":"));
  if (fromId) return fromId;
  if (!job.url) return undefined;
  try {
    const u = new URL(job.url);
    for (const k of ["gh_jid", "jobId", "job_id", "jid"]) {
      const v = plain(u.searchParams.get(k));
      if (v) return v;
    }
    return plain(u.pathname.split("/").filter(Boolean).pop());
  } catch {
    return undefined;
  }
}

/** The three drafts, filled from the job and the person. */
export function draftTemplates({ job, company, first, background }: DraftInputs): Record<DraftKind, string> {
  const hi = first ? `Hi ${first},` : "Hi,";
  const link = safeUrl(job.url);
  const jobId = jobIdOf(job);
  const ref = [link, jobId && `job ID ${jobId}`].filter(Boolean).join(", ");
  return {
    note: `${hi} I'm applying for the ${job.title} role at ${company} and would love to hear what it's like on your team. Open to a quick chat?`,
    ask: [
      `${hi} I'm applying for ${job.title} at ${company}${ref ? ` (${ref})` : ""}.`,
      background && `My background in ${background} fits what the team needs.`,
      "Would you be open to referring me? I can send my resume and a short note you can forward. Thanks either way.",
    ]
      .filter(Boolean)
      .join(" "),
    follow: `${hi} following up on my note about the ${job.title} role at ${company}. Happy to share more if it helps. Thanks for your time.`,
  };
}

const AI_LIMIT: Record<DraftKind, number> = { note: NOTE_LIMIT, ask: 600, follow: 400 };
const AI_GOAL: Record<DraftKind, string> = {
  note: "Ask whether they'd be open to a quick chat about their team.",
  ask: "Ask whether they'd be open to referring me.",
  follow: "Follow up briefly on my earlier note, without pressure.",
};

/** A prompt to paste into your own AI. It holds the job and the person's position, never your resume. */
export function aiPrompt(kind: DraftKind, { job, company, first, position }: DraftInputs): string {
  const who = `${first ?? "someone"}${position ? ` (${position})` : ""}`;
  const link = safeUrl(job.url);
  return [
    `Write a short, friendly LinkedIn message (under ${AI_LIMIT[kind]} characters) from me to ${who} at ${company}.`,
    "We're connected on LinkedIn.",
    `I'm applying for ${job.title}${link ? ` (${link})` : ""}.`,
    AI_GOAL[kind],
    "Plain tone. No flattery, no buzzwords. Never offer payment or anything in return.",
  ].join(" ");
}
