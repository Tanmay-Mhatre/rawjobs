import { SENIORITY_LEVELS } from "@rawjobs/core/catalog/seniority";
import type { Job } from "../../lib/data";

export const SENIORITY_LABEL = Object.fromEntries(SENIORITY_LEVELS.map((s) => [s.id, s.label]));
export const WORKPLACE_LABEL: Record<Job["workplace"], string | null> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote", unknown: null };
