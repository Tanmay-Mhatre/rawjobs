import { employmentType } from "../catalog/employment";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { detectAs, isoDate, xmlAll, xmlBlocks, xmlOne } from "./parse";
import { jobId, type Connector } from "./types";

/** One <position> of {company}.jobs.personio.com/xml, the public job feed (descriptions included). */
export type PersonioPosition = {
  id: string;
  name: string;
  offices: string[];
  department: string;
  createdAt: string;
  sections: { name: string; value: string }[];
  /** "permanent", "intern", "trainee", "freelance", "temporary", "working_student". */
  employmentType?: string;
  /** "full-time", "part-time", "full-or-part-time". */
  schedule?: string;
};

/** Parsed from the feed: Personio publishes XML only. */
export function parsePersonio(xml: string): PersonioPosition[] {
  return xmlBlocks(xml, "position").map((p) => {
    const extra = xmlBlocks(p, "additionalOffices")[0] ?? "";
    // The position's own <office> comes before any <additionalOffices> block.
    const own = xmlOne(p.replace(/<additionalOffices>[\s\S]*?<\/additionalOffices>/, ""), "office");
    return {
      id: xmlOne(p, "id"),
      name: xmlOne(p.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/, ""), "name"),
      offices: [...new Set([own, ...xmlAll(extra, "office")].filter(Boolean))],
      department: xmlOne(p, "department"),
      createdAt: xmlOne(p, "createdAt"),
      sections: xmlBlocks(p, "jobDescription").map((d) => ({ name: xmlOne(d, "name"), value: xmlOne(d, "value") })),
      employmentType: xmlOne(p, "employmentType") || undefined,
      schedule: xmlOne(p, "schedule") || undefined,
    };
  });
}

export const personio: Connector<PersonioPosition> = {
  ats: "personio",
  detect: detectAs("personio"),

  async fetch(ref, { http }) {
    const xml = await http.getText(`https://${ref.slug}.jobs.personio.com/xml`);
    if (!/<workzag-jobs/.test(xml)) throw new Error("unexpected Personio response: not a job feed");
    return parsePersonio(xml);
  },

  normalize(raw, ref): NormalizedJob {
    const location = raw.offices.join("; ");
    return {
      id: jobId("personio", ref.slug, raw.id),
      ats: "personio",
      company: ref.name,
      title: raw.name.trim(),
      location,
      workplace: inferWorkplace(location),
      department: raw.department || undefined,
      postedAt: isoDate(raw.createdAt),
      url: `https://${ref.slug}.jobs.personio.com/job/${raw.id}`,
      employmentType: employmentType([raw.employmentType, raw.schedule]),
      description: raw.sections.map((s) => `${s.name}\n${htmlToText(s.value)}`).join("\n\n"),
    };
  },
};
