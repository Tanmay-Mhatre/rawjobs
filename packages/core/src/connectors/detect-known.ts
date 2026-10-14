import { firstPathSegment, type DetectedCompany } from "./types";

/** Zoho Recruit's data centres: .com (US), .eu, .in, .com.au, .jp, .ca, .sa, .uk, .com.cn. */
export const ZOHO_HOST = /\.zohorecruit\.(com|eu|in|com\.au|jp|ca|sa|uk|com\.cn)$/;

/**
 * Careers URLs of the hiring systems whose connectors share this detection (everything beyond
 * Greenhouse, Lever, Ashby and SmartRecruiters). Each returns what its connector needs to fetch.
 */
export function detectKnownAts(url: URL): DetectedCompany | null {
  const host = url.hostname.toLowerCase();
  const sub = host.split(".")[0] ?? "";
  const seg = firstPathSegment(url);

  // {tenant}.wd{N}.myworkdayjobs.com/[en-US/]{site}
  const wd = host.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    // The jobs API: /wday/cxs/{tenant}/{site}/jobs
    if (parts[0] === "wday" && parts[1] === "cxs") return parts[3] ? { ats: "workday", slug: wd[1]!, shard: wd[2]!, site: parts[3] } : null;
    const site = parts.find((p) => !/^[a-z]{2}(-[A-Z]{2})?$/.test(p)) ?? undefined;
    return { ats: "workday", slug: wd[1]!, shard: wd[2]!, site };
  }
  // The same boards on Workday's path-style host: wd{N}.myworkdaysite.com/[en-US/]recruiting/{tenant}/{site}
  // (or its /wday/cxs/{tenant}/{site} API). The jobs API also answers on {tenant}.wd{N}.myworkdayjobs.com.
  const wds = host.match(/^(wd\d+)\.myworkdaysite\.com$/);
  if (wds) {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const i = parts.findIndex((p) => p === "recruiting" || p === "cxs");
    const [tenant, site] = i >= 0 ? [parts[i + 1], parts[i + 2]] : [];
    return tenant && site ? { ats: "workday", slug: tenant.toLowerCase(), shard: wds[1]!, site } : null;
  }
  // apply.workable.com/j/{shortcode} is one job with no account in the link: not a board we can name.
  if (host === "apply.workable.com" && seg && seg !== "api" && seg !== "j") return { ats: "workable", slug: seg };
  if (host.endsWith(".workable.com") && sub && !["www", "apply", "jobs"].includes(sub)) return { ats: "workable", slug: sub };
  if (host.endsWith(".recruitee.com") && sub && sub !== "www") return { ats: "recruitee", slug: sub };
  if (/\.jobs\.personio\.(de|com)$/.test(host)) return { ats: "personio", slug: sub };
  if (host.endsWith(".bamboohr.com") && sub && sub !== "www") return { ats: "bamboohr", slug: sub };
  if (host.endsWith(".breezy.hr") && sub && sub !== "app") return { ats: "breezy", slug: sub };

  // Often found by the careers-page resolver (scripts/catalog/resolve.ts).
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // SAP SuccessFactors: career{N}.successfactors.com/career?company=acme (also .eu / sapsf.com hosts).
  // The host is the company's data centre, kept in `shard`.
  if (/(^|\.)successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu|cn)$/.test(host)) {
    const company = url.searchParams.get("company");
    return company ? { ats: "successfactors", slug: company, shard: host } : null;
  }
  // SuccessFactors career sites on SAP's own hosts: acme.jobs2web.com, acme.jobs.hr.cloud.sap. The host is the board.
  if (/^[a-z0-9-]+\.(jobs2web\.com|jobs\.hr\.cloud\.sap)$/.test(host)) return { ats: "successfactors", slug: host };
  if (host.endsWith(".teamtailor.com") && sub && !["www", "app", "career", "api"].includes(sub)) return { ats: "teamtailor", slug: sub };
  // Comeet: comeet.com/jobs/{company}/{uid}. Keyed by the company uid; the name goes in `site`.
  if (/(^|\.)comeet\.(com|co)$/.test(host) && parts[0] === "jobs" && parts[1] && parts[2]) return { ats: "comeet", slug: parts[2], site: parts[1] };
  // Oracle Recruiting Cloud: {pod}.fa.{dc}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{site}
  const oracle = host.match(/^([^.]+)\.fa\.([^.]+)\.oraclecloud\.com$/);
  if (oracle && /candidateexperience/i.test(url.pathname)) {
    const i = parts.findIndex((p) => p.toLowerCase() === "sites");
    return { ats: "oracle", slug: oracle[1]!, shard: oracle[2]!, site: i >= 0 ? parts[i + 1] : undefined };
  }
  // iCIMS portals: careers-acme.icims.com, jobs-acme.icims.com… The whole subdomain is the portal.
  if (host.endsWith(".icims.com") && sub && !["www", "cdn", "cdn01", "cdn02", "community", "careers", "hrjobs"].includes(sub)) return { ats: "icims", slug: sub };
  // Taleo: {company or pod}.taleo.net/careersection/{section}/jobsearch.ftl. Pods (aa010…) host many
  // companies, so the section name is part of the key.
  // Taleo Business Edition ({pod}.tbe.taleo.net) is a different system: its pod is shared by hundreds of companies.
  if (host.endsWith(".taleo.net") && sub && sub !== "www" && !host.endsWith(".tbe.taleo.net")) {
    const section = parts[0] === "careersection" ? parts[1] : undefined;
    const real = section && !/^\d{4}PRD|^(rest|iam|theme|careersection|application\.jss)$/i.test(section) ? section : undefined;
    return { ats: "taleo", slug: sub, ...(real ? { site: real } : {}) };
  }
  if (host === "jobs.jobvite.com" && seg) return { ats: "jobvite", slug: seg };
  if (host.endsWith(".pinpointhq.com") && sub && !["www", "app", "api"].includes(sub)) return { ats: "pinpoint", slug: sub };
  // ats.rippling.com/[en-CA/]{board}/jobs: a locale may come first.
  if (host === "ats.rippling.com") {
    const board = /^[a-z]{2}(-[a-z]{2})?$/i.test(parts[0] ?? "") && parts[1] ? parts[1] : parts[0];
    if (board && board !== "api") return { ats: "rippling", slug: board };
  }
  if (host.endsWith(".applytojob.com") && sub && sub !== "www") return { ats: "jazzhr", slug: sub };
  // Zoho Recruit: {company}.zohorecruit.{data centre}/jobs/{careers page}. A board answers only on its
  // own data centre's domain, kept in `shard` when it isn't .com.
  const zoho = host.match(ZOHO_HOST);
  if (zoho && sub && sub !== "www") {
    const dc = zoho[1]!;
    return { ats: "zoho", slug: sub, ...(dc !== "com" ? { shard: dc } : {}), ...(parts[0] === "jobs" && parts[1] ? { site: parts[1] } : {}) };
  }
  if (host.endsWith(".careers.hibob.com") && sub) return { ats: "hibob", slug: sub };
  if (host.endsWith(".freshteam.com") && sub && sub !== "www") return { ats: "freshteam", slug: sub };
  return null;
}
