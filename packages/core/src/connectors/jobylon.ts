import { employmentType } from "../catalog/employment";
import type { HttpError } from "../http";
import { robotsAllows } from "../robots";
import type { NormalizedJob } from "../schema";
import { htmlToText, inferWorkplace } from "../text";
import { BoardClosedError, isoDate, jobPostingLd, workplaceFrom } from "./parse";
import { jobId, type Connector } from "./types";

/**
 * Jobylon, a Nordic hiring system: company pages at emp.jobylon.com/companies/{id}-{name}/, kept as
 * slug = the company number. The careers-site widget, cdn.jobylon.com/jobs/companies/{id}/embed/v2/,
 * lists every published job in one request as a JavaScript literal (JBL.embed_v2['jobs'] = [...],
 * single-quoted, so not JSON: read by jsLiteral() below, no eval). A job's own page on
 * emp.jobylon.com has the description and date in its JSON-LD. robots.txt allows both hosts except
 * /jobs/*\/preview/.
 */
export type JobylonJob = {
  id: string;
  url: string;
  title: string;
  company?: string;
  locations?: string[];
  locations_text?: string;
  departments?: string[];
  workspace?: string;
  employment_type?: string;
};

const ID = /^\d+$/;
const BASE = "https://emp.jobylon.com";

/**
 * The JavaScript object or array literal at `start` (quoted strings, bare keys, trailing commas,
 * true/false/null, numbers) as plain data. Throws on anything else, so code never runs.
 */
export function jsLiteral(src: string, start: number): unknown {
  let i = start;
  const fail = (): never => {
    throw new Error(`unexpected "${src[i] ?? "end"}" at ${i} in the Jobylon job list`);
  };
  const space = () => {
    while (/\s/.test(src[i] ?? "")) i++;
  };
  const word = () => {
    const m = /^[\w$.+-]+/.exec(src.slice(i, i + 64));
    if (!m) return fail();
    i += m[0].length;
    return m[0];
  };
  const string = () => {
    const quote = src[i++];
    let out = "";
    while (i < src.length && src[i] !== quote) {
      const ch = src[i++]!;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const e = src[i++]!;
      if (e === "u" || e === "x") {
        const n = e === "u" ? 4 : 2;
        out += String.fromCharCode(Number.parseInt(src.slice(i, i + n), 16));
        i += n;
      } else out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
    }
    if (src[i++] !== quote) fail();
    return out;
  };
  const value = (): unknown => {
    space();
    const c = src[i];
    if (c === "'" || c === '"') return string();
    if (c === "[" || c === "{") {
      const close = c === "[" ? "]" : "}";
      const arr: unknown[] = [];
      const obj: Record<string, unknown> = {};
      i++;
      for (;;) {
        space();
        if (src[i] === close) {
          i++;
          return c === "[" ? arr : obj;
        }
        if (c === "[") arr.push(value());
        else {
          const key = src[i] === "'" || src[i] === '"' ? string() : word();
          space();
          if (src[i++] !== ":") fail();
          const v = value();
          if (key !== "__proto__") obj[key] = v;
        }
        space();
        if (src[i] === ",") i++;
        else if (src[i] !== close) fail();
      }
    }
    const w = word();
    if (w === "true" || w === "false") return w === "true";
    if (w === "null" || w === "undefined") return null;
    return Number.isNaN(Number(w)) ? fail() : Number(w);
  };
  return value();
}

/** The jobs in a Jobylon embed/v2 page. */
export function parseJobylonEmbed(html: string): JobylonJob[] | undefined {
  const at = html.indexOf("JBL.embed_v2['jobs']");
  const start = at < 0 ? -1 : html.indexOf("[", at + 20);
  if (start < 0) return undefined;
  const jobs = jsLiteral(html, start);
  return Array.isArray(jobs) ? (jobs as JobylonJob[]).filter((j) => j?.id && j.title) : undefined;
}

export const jobylon: Connector<JobylonJob> = {
  ats: "jobylon",

  detect(url) {
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    // emp.jobylon.com/companies/3402-rusta/ or the widget's cdn.jobylon.com/jobs/companies/3402/embed/...
    const seg = host === "emp.jobylon.com" && parts[0] === "companies" ? parts[1] : host === "cdn.jobylon.com" && parts[1] === "companies" ? parts[2] : undefined;
    const id = seg?.match(/^(\d+)(?:-|$)/)?.[1];
    return id ? { ats: "jobylon", slug: id } : null;
  },

  async fetch(ref, { http }) {
    if (!ID.test(ref.slug)) throw new Error(`Jobylon company should be a number, got "${ref.slug}"`);
    const url = `https://cdn.jobylon.com/jobs/companies/${ref.slug}/embed/v2/?target=x`;
    if (!(await robotsAllows(http, url))) throw new Error("robots.txt asks us not to read cdn.jobylon.com/jobs/");
    let html: string;
    try {
      html = await http.getText(url);
    } catch (err) {
      if ((err as HttpError).status === 404) throw new BoardClosedError("Jobylon", ref.slug, "(no company page)");
      throw err;
    }
    const jobs = parseJobylonEmbed(html);
    if (!jobs) throw new Error("unexpected Jobylon response: no job list in the widget");
    return jobs;
  },

  normalize(raw, ref): NormalizedJob {
    const location = raw.locations_text || (raw.locations ?? []).join("; ");
    // "Hybrid", "Remote", or Swedish "Arbete på plats" (on site) / "Distans" (remote).
    const ws = raw.workspace ?? "";
    return {
      id: jobId("jobylon", ref.slug, raw.id),
      ats: "jobylon",
      company: ref.name,
      title: raw.title.trim(),
      location,
      workplace: workplaceFrom(ws) ?? (/distans/i.test(ws) ? "remote" : /på plats/i.test(ws) ? "onsite" : inferWorkplace(`${location} ${raw.title}`)),
      department: raw.departments?.[0] || undefined,
      url: `${BASE}${raw.url.startsWith("/") ? raw.url : `/jobs/${raw.id}/`}`,
      employmentType: employmentType(raw.employment_type),
      // The list has no descriptions; run.ts asks describe() for the jobs that pass the gates.
      description: "",
    };
  },

  async describe(raw, _ref, { http }) {
    const ld = jobPostingLd(await http.getText(`${BASE}${raw.url}`));
    return {
      description: htmlToText(ld?.description ?? ""),
      ...(isoDate(ld?.datePosted) ? { postedAt: isoDate(ld?.datePosted) } : {}),
    };
  },
};
