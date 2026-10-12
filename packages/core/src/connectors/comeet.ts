import type { NormalizedJob, Workplace } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { countryName, detectAs, isoDate, joinParts, jsonAfter } from "./parse";
import { jobId, type Connector } from "./types";

/** A position as Comeet's hosted careers page embeds it (COMPANY_POSITIONS_DATA), descriptions included. */
export type ComeetPosition = {
  uid: string;
  name: string;
  department?: string | null;
  location?: { name?: string; city?: string; state?: string; country?: string; is_remote?: boolean } | null;
  url_active_page?: string | null;
  url_comeet_hosted_page?: string;
  workplace_type?: string | null;
  time_updated?: string;
  custom_fields?: { details?: { name?: string; value?: string }[] };
};

const WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

/** The hosted page's address needs the company's name slug; seeds without one fall back to its name ("eToro" -> "etoro"). */
const nameSlug = (ref: { site?: string; name: string }) =>
  ref.site ||
  ref.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const comeet: Connector<ComeetPosition> = {
  ats: "comeet",
  detect: detectAs("comeet"),

  async fetch(ref, { http }) {
    const html = await http.getText(`https://www.comeet.com/jobs/${encodeURIComponent(nameSlug(ref))}/${encodeURIComponent(ref.slug)}`);
    const positions = jsonAfter<ComeetPosition[]>(html, "COMPANY_POSITIONS_DATA =");
    if (!Array.isArray(positions)) throw new Error(`Comeet board not found: check the company name ("site") for ${ref.slug}`);
    return positions;
  },

  normalize(raw, ref): NormalizedJob {
    const l = raw.location ?? {};
    const country = countryName(l.country);
    const workplace = WORKPLACE[raw.workplace_type?.toLowerCase() ?? ""] ?? (l.is_remote ? "remote" : undefined);
    const location = joinParts(l.city, l.name, country, workplace === "remote" ? "Remote" : undefined);
    return {
      id: jobId("comeet", ref.slug, raw.uid),
      ats: "comeet",
      company: ref.name,
      title: raw.name.trim(),
      location,
      country,
      workplace: workplace ?? inferWorkplace(location),
      department: raw.department ?? undefined,
      // Comeet gives no creation date, only when the position was last edited: the job is at least this
      // old. A later edit can't make it look newer (run.ts keeps the earliest date).
      postedAt: isoDate(raw.time_updated),
      url: raw.url_active_page || raw.url_comeet_hosted_page || `https://www.comeet.com/jobs/${nameSlug(ref)}/${ref.slug}`,
      description: (raw.custom_fields?.details ?? []).map((d) => [d.name, htmlToText(d.value)].filter(Boolean).join("\n")).join("\n\n"),
    };
  },
};
