import type { Job } from "../src/lib/data";

let n = 0;
const DAY = 86_400_000;

/**
 * A dashboard job (jobs.json's shape) with every field set: a senior product manager role at Acme
 * in Dubai, seen yesterday. Override only what a test is about. Ids (and groups) are unique per call.
 */
export function makeJob(o: Partial<Job> = {}): Job {
  const id = o.id ?? `greenhouse:acme:${++n}`;
  return {
    id,
    ats: "greenhouse",
    company: "Acme",
    title: "Senior Product Manager",
    location: "Dubai",
    workplace: "onsite",
    url: "https://acme.example/jobs/1",
    firstSeen: new Date(Date.now() - DAY).toISOString(),
    lastSeen: new Date().toISOString(),
    postedAt: new Date(Date.now() - DAY).toISOString(),
    status: "open",
    score: 75,
    why: { title: 30, location: 20, keywords: [], keywordPoints: 0, freshness: 10 },
    countries: ["United Arab Emirates"],
    cities: ["Dubai, United Arab Emirates"],
    seniority: "senior",
    group: `Acme|senior product manager|${id}`,
    hasDescription: false,
    ...o,
  };
}
