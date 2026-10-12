import { BROAD_TITLE_SYNONYMS, TITLE_ABBREVIATIONS, TITLE_HEADS, TITLE_SPELLINGS, TITLE_SYNONYMS } from "./catalog/titles";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * HTML to readable plain text. Handles double-escaped HTML (Greenhouse sends `&lt;p&gt;`).
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  // Escaped markup: decode once so the tags become real tags.
  if (!/<[a-z!/]/i.test(s) && /&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const regexCache = new Map<string, RegExp>();

/**
 * Whole-word, case-insensitive matcher. "ai" matches "AI-native" but not "maintain";
 * spaces in a term match any run of spaces or hyphens ("product manager" ~ "Product-Manager").
 */
export function termRegex(term: string): RegExp {
  const key = term.toLowerCase().trim();
  let re = regexCache.get(key);
  if (!re) {
    const body = key
      .split(/[\s\-]+/)
      .filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\-]+");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
    regexCache.set(key, re);
  }
  return re;
}

export function matchesTerm(text: string, term: string): boolean {
  return termRegex(term).test(text);
}

const anyCache = new Map<string, RegExp | null>();

/**
 * True if any term matches (same whole-word rules as matchesTerm). The terms are compiled into
 * one cached pattern, so this is one regex test instead of one per term: it matters when scoring
 * hundreds of thousands of job titles.
 */
export function matchesAny(text: string, terms: readonly string[]): boolean {
  if (!terms.length) return false;
  const key = terms.join("\u0000");
  let re = anyCache.get(key);
  if (re === undefined) {
    const parts = terms.map((t) => t.toLowerCase().trim()).filter(Boolean);
    re = parts.length ? new RegExp(parts.map((t) => `(?:${termRegex(t).source})`).join("|"), "iu") : null;
    anyCache.set(key, re);
  }
  return re ? re.test(text) : false;
}

export function matchingTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((t) => matchesTerm(text, t));
}

// ---------- job titles ----------

/** Plural to singular, the same way for titles and terms: "designers" -> "designer", "companies" -> "company". */
function stem(word: string): string {
  if (word.length <= 3 || !word.endsWith("s") || /(?:ss|us|is)$/.test(word)) return word;
  return word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.slice(0, -1);
}

const stemAll = (s: string) => s.split(" ").map(stem).join(" ");
const SPELLING = new Map(Object.entries(TITLE_SPELLINGS).flatMap(([to, from]) => from.map((f) => [stemAll(f), to] as const)));
const SPELLING_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...SPELLING.keys()].join("|")})(?![\\p{L}\\p{N}])`, "gu");
/** "eng" is "engineering" in "eng manager", "head of eng", "vp eng"; otherwise "engineer". */
const ENG_TEAM_NEXT = new Set(["manager", "mgr", "lead", "director", "dir", "team", "leader"]);
const ENG_TEAM_PREV = new Set(["of", "vp", "president", "head"]);
/** Trailing level marks that sit after the job noun: "Engineer II, Backend". */
const LEVEL = /^(?:i{1,3}|iv|v|vi|\d+|l\d)$/;

/** One piece of a title as matching words: short forms spelled out, one spelling per word, plurals singular. */
function titleWords(words: string[]): string {
  const out = words.map((w, i) => {
    if (w === "eng") return ENG_TEAM_NEXT.has(words[i + 1] ?? "") || ENG_TEAM_PREV.has(words[i - 1] ?? "") ? "engineering" : "engineer";
    return TITLE_ABBREVIATIONS[w] ?? TITLE_ABBREVIATIONS[stem(w)] ?? w;
  });
  return stemAll(stemAll(out.join(" ")).replace(SPELLING_RE, (m) => SPELLING.get(m)!));
}

/** "UX/UI Designer" -> "ux ui designer", "ux designer", "ui designer" (the first two slashed words only). */
function slashVariants(words: string[]): string[][] {
  const out: string[][] = [words.flatMap((w) => w.split("/").filter(Boolean))];
  const slashed = words.flatMap((w, i) => (w.includes("/") ? [i] : [])).slice(0, 2);
  let lists: string[][] = [words];
  for (const i of slashed) lists = lists.flatMap((l) => l[i]!.split("/").filter(Boolean).map((alt) => l.map((w, j) => (j === i ? alt : w))));
  if (slashed.length) out.push(...lists);
  return out;
}

/** Times of day ("3:00 P.M.", "7 pm"): not the "PM" job title. Lowercase text. */
const TIME_OF_DAY = /(?<!\p{L})[ap]\.m\.?(?!\p{L})|(?<=\d\s?)[ap]m(?!\p{L})/gu;
/**
 * Shift work ("Handler / Warehouse Operator (PM)", "Package Handler - PM Shift"): there "AM" and "PM" name
 * the shift. Checked on the whole title, since "(PM)" is a piece of its own.
 */
const SHIFT_WORK = /(?<!\p{L})(?:shifts?|hourly|handlers?|loaders?|pickers?|packers?|sortation|overnight|night|weekends?)(?!\p{L})/iu;
const SHIFT = /(?<!\p{L})[ap]m(?!\p{L})/giu;
/** "SAP PM", "EAM PM": plant maintenance, a module, not a product manager. */
const PLANT_MAINTENANCE = /(?<!\p{L})(sap|eam|maximo)([\s/-]+)pm(?!\p{L})/gu;

function wordsOf(text: string): string[] {
  const lower = text.toLowerCase().replace(TIME_OF_DAY, " ").replace(PLANT_MAINTENANCE, "$1$2plant maintenance");
  return (/[^\x00-\x7f]/.test(lower) ? lower.normalize("NFKD") : lower)
    .replace(/[\u0300-\u036f'’.]/g, "")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}+#/]+/u)
    .filter((w) => w && w !== "/");
}

/**
 * Words that make "<word> lead" or "<word> manager" a different job: a team lead, tech lead or
 * engineering manager for a product isn't that product's lead or manager.
 */
const ROLE_QUALIFIERS = new Set(["team", "tech", "technical", "engineering", "project", "program", "delivery", "release", "store", "shift", "site"]);

const formsCache = new Map<string, string>();

/**
 * A job title in matching form: every reading of it, joined by " | " so no term matches across two.
 * "Sr. Manager, Product" -> "senior manager | product | senior product manager | senior manager of product".
 * The part before a comma or dash is turned around only when it ends in a job noun (TITLE_HEADS).
 */
export function titleForms(title: string): string {
  let forms = formsCache.get(title);
  if (forms !== undefined) return forms;
  const segments = (SHIFT_WORK.test(title) ? title.replace(SHIFT, " ") : title)
    .split(/\s+[-–—/|:]\s+|[,;()[\]–—|:]/)
    .map((s) => slashVariants(wordsOf(s)).map(titleWords).filter(Boolean))
    .filter((v) => v.length);
  const out = segments.flat();
  for (let i = 0; i + 1 < segments.length; i++) {
    const words = segments[i]![0]!.split(" ");
    let h = words.length - 1;
    while (h > 0 && LEVEL.test(words[h]!)) h--;
    if (!TITLE_HEADS.has(words[h]!)) continue;
    // "Team Lead, Android Core Product" leads a team, not a product: no "android core product lead".
    const role = ROLE_QUALIFIERS.has(words[h - 1] ?? "");
    for (const next of segments[i + 1]!) {
      if (!role) out.push([...words.slice(0, h), next, ...words.slice(h)].join(" "));
      out.push(`${words.join(" ")} of ${next}`);
    }
  }
  forms = [...new Set(out)].join(" | ");
  if (formsCache.size > 20_000) formsCache.clear();
  formsCache.set(title, forms);
  return forms;
}

const canonical = (term: string) => titleWords(slashVariants(wordsOf(term))[0]!);
const synonymGroups = (groups: string[][]) => groups.map((g) => g.map(canonical));
const SYNONYMS = synonymGroups(TITLE_SYNONYMS);
const BROAD = synonymGroups(BROAD_TITLE_SYNONYMS);

/** Your terms in matching form, plus the same term with each equivalent title swapped in. */
export function expandTitleTerms(terms: readonly string[], o: { broad?: boolean } = {}): string[] {
  const groups = o.broad ? [...SYNONYMS, ...BROAD] : SYNONYMS;
  const out = new Set<string>();
  for (const term of terms) {
    const t = canonical(term);
    if (!t) continue;
    out.add(t);
    for (const g of groups)
      for (const p of g) {
        if (!` ${t} `.includes(` ${p} `)) continue;
        for (const q of g) if (q !== p) out.add(` ${t} `.replace(` ${p} `, ` ${q} `).trim());
      }
  }
  return [...out];
}

const titleCache = new Map<string, RegExp | null>();

/** One pattern for a list of title terms, compiled once per list. "of" may sit between words ("vp product" ~ "vp of product"). */
export function titleTermsPattern(terms: readonly string[], o: { broad?: boolean } = {}): RegExp | null {
  const key = `${o.broad ? 1 : 0}\u0000${terms.join("\u0000")}`;
  let re = titleCache.get(key);
  if (re === undefined) {
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = expandTitleTerms(terms, o).map((t) => t.split(" ").map(esc).join(" (?:of )?"));
    re = parts.length ? new RegExp(`(?<![\\p{L}\\p{N}+#])(?:${parts.join("|")})(?![\\p{L}\\p{N}+#])`, "u") : null;
    titleCache.set(key, re);
  }
  return re;
}

/** Common words that say little on their own: a term's anchor is one of its other words when it has one. */
const GENERIC_TITLE_WORDS = new Set(["manager", "engineer", "senior", "lead", "head", "of", "director", "principal", "staff", "junior", "associate", "specialist", "and", "the", "chief", "officer", "vice", "president"]);
const anchorCache = new Map<string, Set<string>>();

/**
 * Words at least one of which a title must contain to match these terms (matchesTitle). For each
 * term, as written and in every equivalent form, its most telling word; plus the abbreviations and
 * other spellings that read as one of those words ("pm", "swe", "front end", "eng").
 */
function titleAnchors(terms: readonly string[]): Set<string> {
  const key = terms.join("\u0000");
  let raw = anchorCache.get(key);
  if (raw) return raw;
  const need = new Set<string>();
  const pick = (words: string[]) => {
    const telling = words.filter((w) => !GENERIC_TITLE_WORDS.has(w));
    for (const w of telling.length ? [telling.reduce((a, b) => (b.length > a.length ? b : a))] : words) need.add(w);
  };
  for (const t of terms) pick(wordsOf(t).flatMap((w) => w.split("/")).filter(Boolean));
  for (const t of expandTitleTerms(terms)) pick(t.split(" ").filter((w) => w && w !== "of"));
  raw = new Set(need);
  for (const [abbr, full] of Object.entries(TITLE_ABBREVIATIONS)) if (full.split(" ").some((w) => need.has(w))) raw.add(abbr);
  for (const [word, others] of Object.entries(TITLE_SPELLINGS)) if (word.split(" ").some((w) => need.has(w))) for (const o of others) for (const w of o.split(" ")) raw.add(w);
  if (need.has("engineer") || need.has("engineering")) raw.add("eng");
  if (anchorCache.size > 50) anchorCache.clear();
  anchorCache.set(key, raw);
  return raw;
}

/**
 * A quick check that rules out most titles before matchesTitle's full reading: false means the title
 * can't match these terms. It never says false for a title matchesTitle would accept (tests hold it
 * to that on a large sample of real titles); it may say true for titles that then don't match.
 */
export function mayMatchTitle(title: string, terms: readonly string[]): boolean {
  if (!terms.length) return false;
  const raw = titleAnchors(terms);
  const has = (w: string) => !!w && (raw.has(w) || raw.has(stem(w)));
  // Read as matchesTitle does ("Sr. PM" -> "sr", "pm")...
  for (const word of wordsOf(title)) for (const part of [word, ...word.split(/\/|(?<=[+#])(?=\p{L})/u)]) if (has(part)) return true;
  // ...and as written, where matchesAny's literal check splits "Sr.Product" and "CFO's" at the punctuation.
  return title.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).some(has);
}

/**
 * Does a job title name one of these terms? Like matchesAny, and also after reading both the same
 * way: plurals ("Designers"), short forms ("Sr. PM"), word order ("Manager, Product"), slashes
 * ("UX/UI Designer") and equivalent titles ("Software Developer" for "software engineer").
 * Whole words still: "production manager" never matches "product manager".
 */
export function matchesTitle(title: string, terms: readonly string[], forms?: string): boolean {
  if (!terms.length) return false;
  if (matchesAny(title, terms)) return true;
  return !!titleTermsPattern(terms)?.test(forms ?? titleForms(title));
}

/** Best-effort workplace from free-text location, for ATSs that don't send one. */
export function inferWorkplace(location: string): "remote" | "hybrid" | "unknown" {
  if (matchesTerm(location, "hybrid")) return "hybrid";
  if (matchesTerm(location, "remote")) return "remote";
  return "unknown";
}

/**
 * Boards that aren't a real employer: ATS vendors' sandboxes, training and demo tenants, test accounts
 * ("Lever Implementation Training Environment", "Rhaegal - Arago Sandbox", "Acme Test Company").
 * They post fake or years-old jobs, so they're never suggested, listed or scanned.
 */
const PLACEHOLDER_BOARD = /\b(training environment|implementation (?:training|environment)|test (?:company|account|tenant|environment|site|board)|demo (?:company|account|tenant|site|board)|staging|do not use|dummy|sample company)\b/i;
/**
 * "Sandbox" alone is a real brand ("Sandbox VR", "The Sandbox"), so it only counts as a tenant label:
 * after a separator ("Rhaegal - Arago Sandbox", "Acme (Sandbox)"), next to a tenant word
 * ("Test Sandbox", "Sandbox Account"), or as the trailing word of a longer name ("Acme Sandbox", "Acme Sandbox 2").
 */
const SANDBOX_BOARD = [
  /[-–—(|:]\s*(?:[\p{L}\p{N}.&']+\s+){0,3}sandbox\b/iu,
  /\b(?:test|demo|dev|uat|qa|training|partner|customer|implementation)\s+sandbox\b/i,
  /\bsandbox\s+(?:environment|account|tenant|company|site|board|instance|org|organization)\b/i,
  /(?<!\bthe)\s+sandbox\s*\d*\)?\s*$/i,
];
export function isPlaceholderBoard(name: string | undefined | null): boolean {
  return !!name && (PLACEHOLDER_BOARD.test(name) || SANDBOX_BOARD.some((re) => re.test(name)));
}

/**
 * A link that is safe to open: http(s) only, else undefined. Job and careers links come from hiring
 * systems and the shared directory; a "javascript:" one would run on the dashboard's own origin.
 */
export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}
