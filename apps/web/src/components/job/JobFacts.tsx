import { EMPLOYMENT_LABEL } from "@rawjobs/core/catalog/employment";
import { INDUSTRY_BY_ID } from "@rawjobs/core/catalog/industries";
import { sponsorOf, sponsorSentence, VISA_REGISTERS } from "@rawjobs/core/catalog/visa";
import type { useHiring, Job } from "../../lib/data";
import { companyName, eligibilityNotes, formatSalary } from "../../lib/format";
import { cx } from "../ui";
import { SENIORITY_LABEL, WORKPLACE_LABEL } from "./labels";

/** "The job": the decision facts the posting gives, as label / value pairs (where each came from on hover); what it doesn't say shows as "Not stated". */
export function JobFacts(p: {
  job: Job;
  /** Other postings of the same role, when there's more than one. */
  postings: Job[] | null;
  hiringData: ReturnType<typeof useHiring>;
  industries?: string[];
  source: string;
}) {
  const { job, postings, hiringData, source } = p;
  const salary = formatSalary(job.salary);
  // On a government list of visa sponsors for the job's country (any of the role's places).
  const sponsor = sponsorOf(postings ?? [job]);
  // A register listing ("Sponsors visas") already says it: the posting's own "we sponsor" would repeat it.
  const eligibility = eligibilityNotes(job.eligibility).filter((n) => !(sponsor && n.text === "Sponsors a visa"));
  const limits = eligibility.filter((n) => n.limit);
  // "EU only" is read from the title or location, "UAE nationals only" from either the title or the description, the rest from the description.
  const fromTitle = (n: { text: string }) => n.text === `${job.eligibility?.regionOnly} only`;
  const limitsFrom = limits.every(fromTitle)
    ? "From the title or location"
    : job.eligibility?.nationalsOnly && limits.some((n) => n.text.endsWith("nationals only"))
      ? "From the posting"
      : "From the description";
  const last30 = hiringData?.last30 ?? job.surge?.n;
  const usual = hiringData?.usual ?? job.surge?.usual;
  const surge = hiringData ? hiringData.surge : !!job.surge;
  // The decision facts the posting gives, as label / value pairs (where each came from on hover); what it doesn't say shows as "Not stated".
  const industryLabels = (p.industries ?? []).map((i) => INDUSTRY_BY_ID.get(i)?.label ?? i);
  const facts: { label: string; text: string; title: string; tone?: "warn" | "good" }[] = [
    ...(salary ? [{ label: "Pay", text: salary, title: job.salaryFrom === "description" ? "Salary, read from the description" : "Salary, from the posting" }] : []),
    { label: "Level", text: SENIORITY_LABEL[job.seniority] ?? job.seniority, title: "Seniority, read from the title" },
    ...(job.employmentType ? [{ label: "Type", text: EMPLOYMENT_LABEL[job.employmentType], title: `Job type, via ${source}` }] : []),
    ...limits.map((n) => ({ label: "Who can apply", text: n.text, tone: "warn" as const, title: `Who can apply: ${limitsFrom.toLowerCase()}` })),
    ...(sponsor
      ? [
          {
            label: "Visa",
            text: "Sponsors visas",
            tone: "good" as const,
            title: `${sponsorSentence(companyName(job.company), sponsor)} That means it can sponsor, not that this role will. Source: ${VISA_REGISTERS[sponsor.country].source}.`,
          },
        ]
      : []),
    ...eligibility.filter((n) => !n.limit).map((n) => ({ label: "Who can apply", text: n.text, tone: "good" as const, title: "Who can apply: from the description" })),
    ...(last30 !== undefined
      ? [
          {
            label: "Hiring",
            text: `${last30} ${last30 === 1 ? "role" : "roles"} in 30 days`,
            tone: surge ? ("good" as const) : undefined,
            title: surge ? "Company hiring: a surge, far more than usual" : usual !== undefined ? `Company hiring: usually about ${Math.round(usual)}` : "Company hiring",
          },
        ]
      : []),
    ...(job.department ? [{ label: "Team", text: job.department, title: "Department" }] : []),
    ...(industryLabels.length ? [{ label: industryLabels.length > 1 ? "Industries" : "Industry", text: industryLabels.join(", "), title: "Industry" }] : []),
  ];
  // A pay floor already says "Pay not listed" in the verdict.
  const payChecked = job.why.checks?.some((c) => c.id === "pay");
  const notStated = [...(salary || payChecked ? [] : ["Pay"]), ...(WORKPLACE_LABEL[job.workplace] ? [] : ["Work mode"])];
  return (
    <section className="rj-drawer__section gap-3" aria-labelledby={`facts-${job.id}`}>
      <h3 id={`facts-${job.id}`} className="rj-sec-h">
        The job
      </h3>
      <dl className="rj-facts type-small" aria-label="Key facts">
        {facts.map((f) => (
          <div key={`${f.label}:${f.text}`} title={f.title} className="min-w-0">
            <dt className="text-muted">{f.label}</dt>
            <dd className={cx(f.tone === "warn" && "text-warning-text", f.tone === "good" && "text-success-text")}>{f.text}</dd>
          </div>
        ))}
        {notStated.map((n) => (
          <div key={n} className="min-w-0">
            <dt className="text-muted">{n}</dt>
            <dd className="font-normal text-muted">Not stated</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
