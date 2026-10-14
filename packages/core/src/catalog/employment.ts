/**
 * Employment type: full-time, part-time, contract, internship or temporary. Read from what the hiring
 * system says (Lever's "commitment", Ashby's "employmentType", …), else from plain words in the title
 * ("Intern", "(Contract)", "Part-time"). Never guessed: when it's unclear, there's none.
 */
export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "internship", "temporary"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

/** One value as a hiring system writes it ("FullTime", "FULL_TIME", "Part-time", "Contractor", "Werkstudent"). */
function one(value: string): EmploymentType | "permanent" | undefined {
  const s = value.toLowerCase().replace(/[\s_\-/]+/g, "");
  // "Full or part time" says neither.
  if (!s || (/full/.test(s) && /part/.test(s))) return undefined;
  if (/intern(?!a)|trainee|apprentice|werkstudent|workingstudent|praktik|stagiaire|coop$/.test(s)) return "internship";
  if (/parttime|teilzeit|halftime|minijob|mitemps/.test(s)) return "part-time";
  if (/contract|freelance|selfemployed|perdiem|1099|honorar/.test(s)) return "contract";
  if (/temp|seasonal|fixedterm|befristet(?<!unbefristet)|casual|interim/.test(s)) return "temporary";
  if (/fulltime|vollzeit/.test(s)) return "full-time";
  // Permanent says "not a contract": full-time unless another value says part-time.
  if (/permanent|regular|unbefristet|cdi$|salaried/.test(s)) return "permanent";
  return undefined;
}

/**
 * The type a hiring system gave (a string, a list of them, or a yes/no "full time" flag). Several
 * different types ("Full-time, Part-time") say nothing: undefined.
 */
export function employmentType(raw: unknown): EmploymentType | undefined {
  const values = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (typeof v === "string" ? v.split(/\s*[,;|]\s*/) : []));
  return narrowest(values.map(one));
}

/**
 * One type out of several mentions: "Temporary, full-time" and "Permanent, part-time" are the narrower
 * one; full-time *and* part-time, or any other two, say nothing.
 */
function narrowest(types: readonly (EmploymentType | "permanent" | undefined)[]): EmploymentType | undefined {
  const all = types.filter((t) => !!t);
  const others = all.filter((t): t is EmploymentType => t !== "permanent");
  const found = new Set<EmploymentType>(others.length ? others : all.length ? ["full-time"] : []);
  if (found.size === 2 && found.has("full-time") && !found.has("part-time")) found.delete("full-time");
  return found.size === 1 ? [...found][0] : undefined;
}

const TITLE_RULES: [EmploymentType, RegExp][] = [
  // "Intern Program Manager" and "Internship Recruiter" are full-time roles about interns.
  [
    "internship",
    /\b(intern|interns|internship|werkstudent(in)?|working student|praktikum|praktikant(in)?|stagiaire|co-?op|apprentice(ship)?)\b(?!\s+(program|programme|recruit|coordinator|manager))/i,
  ],
  ["part-time", /\b(part[- ]time|teilzeit)\b/i],
  // "Contract Manager" is a full-time job about contracts: only "(Contract)", "- Contract", "Contract role", "6-month contract", "Freelance".
  ["contract", /\bfreelance(r)?\b|(^|[([\-–—|,:]\s*)(contract|contractor)(\s+(role|position|basis|to hire|-?\s*\d+\s*months?))?\s*($|[)\]\-–—|,])|\b\d+[- ]?months?\s+contract\b/i],
  ["temporary", /\b(temporary|temp|seasonal|fixed[- ]term|maternity cover|parental leave cover|befristet)\b/i],
  ["full-time", /\b(full[- ]time|vollzeit)\b/i],
];

/** The type a title states in plain words, if it states exactly one. */
export function employmentTypeOfTitle(title: string): EmploymentType | undefined {
  return narrowest(TITLE_RULES.filter(([, re]) => re.test(title)).map(([t]) => t));
}
