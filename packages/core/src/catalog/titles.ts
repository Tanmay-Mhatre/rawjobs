/**
 * Job-title wording, so "Sr. PM", "Manager, Product" and "Product Managers" all read as
 * "senior product manager" / "product manager". Hand-curated and small on purpose: every entry
 * must mean the same thing in a job title, or matching gets looser than the user asked for.
 *
 * Later this can be extended offline from the O*NET "Alternate Titles" file (CC BY 4.0). If it is,
 * cite the exact database version and "U.S. Department of Labor, Employment and Training
 * Administration (USDOL/ETA)" next to the generated table, and keep only clearly equivalent titles.
 */

/**
 * Short forms, expanded wherever they appear (in job titles and in your own terms alike).
 * Left out on purpose: "tpm" (program or product?), "em", "dev", "admin", "it", "cro" — ambiguous.
 * "pm" is read as product manager, its usual meaning in tech job ads.
 */
export const TITLE_ABBREVIATIONS: Record<string, string> = {
  pm: "product manager",
  pmm: "product marketing manager",
  apm: "associate product manager",
  gpm: "group product manager",
  sr: "senior",
  snr: "senior",
  jr: "junior",
  jnr: "junior",
  mgr: "manager",
  mngr: "manager",
  dir: "director",
  vp: "vice president",
  svp: "senior vice president",
  evp: "executive vice president",
  avp: "assistant vice president",
  assoc: "associate",
  asst: "assistant",
  exec: "executive",
  coord: "coordinator",
  mktg: "marketing",
  engr: "engineer",
  swe: "software engineer",
  sde: "software development engineer",
  sre: "site reliability engineer",
  ml: "machine learning",
  ai: "artificial intelligence",
  nlp: "natural language processing",
  ux: "user experience",
  ui: "user interface",
  qa: "quality assurance",
  hr: "human resources",
  bd: "business development",
  ops: "operations",
  cto: "chief technology officer",
  cpo: "chief product officer",
  ceo: "chief executive officer",
  cfo: "chief financial officer",
  coo: "chief operating officer",
  cmo: "chief marketing officer",
  cio: "chief information officer",
  ciso: "chief information security officer",
  cdo: "chief data officer",
};

/** Words written several ways: every spelling becomes the first one. */
export const TITLE_SPELLINGS: Record<string, string[]> = {
  frontend: ["front end"],
  backend: ["back end"],
  fullstack: ["full stack"],
  devops: ["dev ops"],
  devsecops: ["dev sec ops"],
  "business development": ["biz dev", "bizdev"],
  ecommerce: ["e commerce"],
  cofounder: ["co founder"],
};

/**
 * Titles that mean the same job. A term containing one also matches the others
 * ("senior software engineer" ~ "senior software developer"). Keep every group strictly equivalent.
 */
export const TITLE_SYNONYMS: string[][] = [
  ["software engineer", "software developer"],
  ["frontend engineer", "frontend developer"],
  ["backend engineer", "backend developer"],
  ["fullstack engineer", "fullstack developer"],
  ["mobile engineer", "mobile developer"],
  ["ios engineer", "ios developer"],
  ["android engineer", "android developer"],
  ["director of product", "product director"],
  ["director of engineering", "engineering director"],
  ["head of product", "product head"],
  ["customer success manager", "client success manager"],
  ["people operations", "human resources operations"],
  ["talent acquisition partner", "talent partner"],
  ["solutions architect", "solution architect"],
  // The same work under another name: a DevOps engineer runs the platform. Pairs, so platform, SRE
  // and infrastructure each take DevOps without becoming each other.
  ["platform engineer", "devops engineer"],
  ["site reliability engineer", "devops engineer"],
  ["infrastructure engineer", "devops engineer"],
];

/**
 * Close but broader: a different job at some companies ("product owner" is often a scrum role).
 * Never applied by default; only when a caller opts in (expandTitleTerms(..., { broad: true })).
 */
export const BROAD_TITLE_SYNONYMS: string[][] = [
  ["product manager", "product owner"],
  ["quality assurance engineer", "test engineer"],
  ["recruiter", "talent acquisition"],
  ["human resources business partner", "people partner"],
];

/**
 * The job noun at the end of a title. "Manager, Product" is read as "product manager" (and
 * "manager of product") only when the part before the comma or dash ends in one of these.
 */
export const TITLE_HEADS = new Set([
  "manager", "engineer", "developer", "designer", "director", "lead", "head", "analyst", "scientist", "architect", "specialist",
  "consultant", "officer", "recruiter", "coordinator", "administrator", "president", "owner", "partner", "associate", "executive",
  "representative", "strategist", "writer", "editor", "researcher", "accountant", "counsel", "attorney", "lawyer", "advisor",
  "technician", "operator", "assistant", "planner", "buyer", "auditor", "controller", "economist", "marketer", "programmer", "tester",
]);
