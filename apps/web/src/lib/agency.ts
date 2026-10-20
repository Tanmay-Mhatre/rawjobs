/**
 * A job posted by a recruitment agency, which often doesn't name the employer: people at the
 * agency can't refer you to the client. Bullhorn is the agencies' hiring system, and agencies
 * usually say what they are in their name. Pure.
 */
import type { Job } from "./data";

const AGENCY_NAME = /\b(staffing|recruitment|recruiting|resourcing|personnel|talent solutions|executive search|search partners)\b/i;

export function isAgencyPosting(job: Pick<Job, "ats" | "company">): boolean {
  return job.ats === "bullhorn" || AGENCY_NAME.test(job.company);
}
