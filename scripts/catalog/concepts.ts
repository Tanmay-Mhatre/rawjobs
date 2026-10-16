/**
 * The weekly word list: more words that prove each topic, found automatically and checked
 * automatically, with no one approving them by hand. Run by .github/workflows/concepts-weekly.yml.
 *
 *   1. For each topic in packages/core/src/catalog/concepts.ts, look it up in ESCO (the EU's skills
 *      list). Take a concept only when one of its labels is the topic itself or a word already known
 *      to prove it, and offer that concept's other labels.
 *   2. Keep a word only when it passes every gate (rejectAlias): short, a name and not a task
 *      ("utilise machine learning" is a task), not too general, not a broader word, not another
 *      topic, not on the never-match list.
 *   3. Keep it only when real job titles back it (backedByTitles): across the job feed's companies,
 *      those whose titles use the word mostly use the topic too. "Cardinals" or "taking" never pass.
 *   4. Score the eval set with the new list. If ranking gets worse or scores bunch up, nothing is
 *      published and apps keep last week's list.
 *
 *   pnpm exec tsx scripts/catalog/concepts.ts --out scripts/catalog/out/concepts
 *
 * Source: ESCO (European Commission, reuse with attribution, Decision 2011/833/EU). Wikidata was tried and
 * dropped: its aliases for common words are mostly other senses (sports teams, parties), and it rate-limits.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BASE_CONCEPTS } from "../../packages/core/src/catalog/concepts";
import { type ConceptsFile, namesTopic, setConcepts } from "../../packages/core/src/concepts";
import { evaluate, loadSet } from "../../packages/core/eval/lib";

/** Words never allowed to prove the topic on the left, however a source links them. */
export const NEVER: Record<string, string[]> = {
  java: ["javascript", "java script"],
  javascript: ["java"],
  "product management": ["product marketing", "project management"],
  "product marketing": ["product management"],
  "project management": ["product management"],
  payments: ["payroll"],
  sales: ["presales support"],
  security: ["social security", "food security", "job security"],
  "machine learning": ["learning"],
  ai: ["artificial insemination"],
};

/** Too general to prove anything on their own. */
const GENERAL = new Set(
  "management service services system systems process processes technology technologies software data business operations support solution solutions tool tools method methods analysis development design work skills knowledge".split(
    " ",
  ),
);
/** First words that make a label a task, not a name: "use", "manage", "apply"… */
const TASK =
  /^(?:use|using|utilise|utilize|apply|applying|manage|managing|perform|performing|develop|developing|conduct|create|carry|implement|maintain|monitor|operate|provide|ensure|identify|assess|analyse|analyze|handle|work|working|keep|make|prepare|plan|coordinate|supervise|advise|liaise|communicate|follow|adapt|adhere|comply|evaluate|design|build|write|read|teach|train|promote|negotiate|interpret|process)\b/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .trim();
/** Words of a label, singular: "cards" and "card" are the same word for the broader-word gate. */
const words = (s: string) =>
  norm(s)
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

/** Why a word can't prove a topic, or undefined when it may. Every gate is automatic. */
export function rejectAlias(topic: string, alias: string, known: ReadonlySet<string>): string | undefined {
  const a = norm(alias);
  const w = words(alias);
  if (!/\p{L}/u.test(a)) return "no letters";
  if (a.length < 2 || a.length > 40) return "length";
  if (w.length > 4) return "too many words";
  if (TASK.test(a)) return "a task, not a name";
  if (w.every((x) => GENERAL.has(x))) return "too general";
  if (a.length <= 3 && alias !== alias.toUpperCase()) return "short and not an acronym";
  if (a === norm(topic)) return "the topic itself";
  // A broader word never proves a narrower one: "cards" doesn't prove "card issuing".
  if (w.every((x) => words(topic).includes(x))) return "broader than the topic";
  if (known.has(a)) return "another topic";
  if ((NEVER[norm(topic)] ?? []).some((n) => a === n || a.includes(n))) return "on the never-match list";
  if (/[()[\]{}<>@#$%^*=|\\]/.test(alias)) return "odd characters";
  return undefined;
}

/** The labels a source offers for a topic: only from concepts that name the topic (or a word that already proves it). */
export function offered(topic: string, concepts: readonly string[][]): string[] {
  const names = new Set([norm(topic), ...(BASE_CONCEPTS[topic] ?? []).map(norm)]);
  return concepts.filter((labels) => labels.some((l) => names.has(norm(l)))).flat();
}

const MAX_NEW_PER_TOPIC = 15;

/** Fewest companies whose titles must use a word before it can count, and how much they must use the topic too. */
export const BACKING = { minCompanies: 3, minShare: 0.4, minLift: 3 } as const;

/**
 * Do real job titles back "this word proves this topic"? `companies` is each company's titles, joined.
 * Of the companies using the word, at least minShare must also use the topic, and that share must be
 * minLift times the share of all companies that use it ("security" is everywhere, so "securities" fails).
 */
export function backedByTitles(
  topic: string,
  alias: string,
  companies: readonly string[],
  topicHits = companies.map((t) => namesTopic(t, topic)),
  lower = companies.map((t) => t.toLowerCase()),
): boolean {
  const needle = norm(alias).split(" ")[0]!;
  let withAlias = 0;
  let both = 0;
  const withTopic = topicHits.filter(Boolean).length;
  companies.forEach((titles, i) => {
    if (!lower[i]!.includes(needle) || !namesTopic(titles, alias)) return;
    withAlias++;
    if (topicHits[i]) both++;
  });
  if (withAlias < BACKING.minCompanies || !withTopic) return false;
  const share = both / withAlias;
  return share >= BACKING.minShare && share >= BACKING.minLift * (withTopic / companies.length);
}

/** Each company's job titles from the job feed, joined: what backedByTitles reads. */
async function feedTitles(base = "https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/download/jobs"): Promise<string[]> {
  const manifest = (await json(`${base}/jobs-manifest.json`)) as { shards: Record<string, { file: string }> };
  const out: string[] = [];
  for (const { file } of Object.values(manifest.shards)) {
    const res = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${res.status} ${file}`);
    const shard = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as { companies: Record<string, { jobs: [string, string][] }> };
    // Each company's distinct titles, at most 300: a big employer's thousands of postings repeat themselves.
    for (const c of Object.values(shard.companies)) if (c.jobs.length) out.push([...new Set(c.jobs.map((j) => j[1]))].slice(0, 300).join(" | "));
  }
  return out;
}

/** Every topic's new words, through the gates (and backed by real titles, when they're given). */
export function gate(candidates: Record<string, string[]>, companies?: readonly string[]): Record<string, string[]> {
  const known = new Set(Object.keys(BASE_CONCEPTS).map(norm));
  const lower = companies?.map((t) => t.toLowerCase());
  const out: Record<string, string[]> = {};
  for (const [topic, list] of Object.entries(candidates)) {
    const have = new Set([norm(topic), ...(BASE_CONCEPTS[topic] ?? []).map(norm)]);
    const keep: string[] = [];
    let hits: boolean[] | undefined;
    for (const alias of list) {
      if (keep.length >= MAX_NEW_PER_TOPIC) break;
      if (have.has(norm(alias)) || rejectAlias(topic, alias, known)) continue;
      if (companies && !backedByTitles(topic, alias, companies, (hits ??= companies.map((t) => namesTopic(t, topic))), lower)) continue;
      have.add(norm(alias));
      keep.push(alias.trim());
    }
    if (keep.length) out[topic] = keep;
  }
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function json(url: string, tries = 3): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "RawJobs concepts builder (github.com/Tanmay-Mhatre/rawjobs)" }, signal: AbortSignal.timeout(20_000) });
  // ESCO asks callers to slow down with a 429: wait (at most 10 s) and try again.
  if (res.status === 429 && tries > 1) {
    await pause(Math.min(10_000, Number(res.headers.get("retry-after")) * 1000 || 5000));
    return json(url, tries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

type EscoResult = { preferredLabel?: Record<string, string>; alternativeLabel?: Record<string, string[]> };
async function fromEsco(topic: string): Promise<string[][]> {
  const url = `https://ec.europa.eu/esco/api/search?text=${encodeURIComponent(topic)}&type=skill&language=en&full=true&limit=10`;
  const body = (await json(url)) as { _embedded?: { results?: EscoResult[] } };
  return (body._embedded?.results ?? []).map((r) => [r.preferredLabel?.en ?? "", ...(r.alternativeLabel?.en ?? [])].filter(Boolean));
}

/** The eval set's ranking and tie rate with a word list: the gate for publishing it. */
function measure(file?: ConceptsFile) {
  setConcepts(file);
  const { overall } = evaluate(loadSet());
  setConcepts();
  return overall;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string", default: "scripts/catalog/out/concepts" } } });
  const candidates: Record<string, string[]> = {};
  let failed = 0;
  const topics = Object.keys(BASE_CONCEPTS);
  for (const [i, topic] of topics.entries()) {
    if (i % 20 === 0) console.log(`Looking up topics ${i + 1}-${Math.min(i + 20, topics.length)} of ${topics.length}`);
    const concepts: string[][] = [];
    await pause(300);
    try {
      concepts.push(...(await fromEsco(topic)));
    } catch (e) {
      failed++;
      console.warn(`  ESCO ${topic}: ${(e as Error).message}`);
    }
    candidates[topic] = offered(topic, concepts);
  }
  if (failed > topics.length / 2) throw new Error(`${failed} lookups failed: not publishing a list built on half the sources`);

  console.log("Reading the job feed's titles");
  const companies = await feedTitles();
  console.log(`${companies.length} companies; checking words against their titles`);
  if (companies.length < 1000) throw new Error(`Only ${companies.length} companies in the job feed: not enough titles to check words against`);
  const file: ConceptsFile = { version: new Date().toISOString().slice(0, 10), concepts: gate(candidates, companies) };
  const added = Object.values(file.concepts).reduce((n, a) => n + a.length, 0);
  const before = measure();
  const after = measure(file);
  console.log(`${added} new words for ${Object.keys(file.concepts).length} topics. NDCG@10 ${before.ndcg10} -> ${after.ndcg10}, ties ${before.ties} -> ${after.ties}`);
  // Automatic eval gate: a list that ranks worse or bunches scores up is never published.
  if (after.ndcg10 < before.ndcg10 - 0.002 || after.ties > before.ties + 0.01 || after.tiesNoTopics > before.tiesNoTopics + 0.01) {
    console.error("The new words make the eval worse: not publishing. Apps keep last week's list.");
    process.exit(2);
  }
  mkdirSync(values.out!, { recursive: true });
  writeFileSync(join(values.out!, "concepts.json"), `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${join(values.out!, "concepts.json")}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/catalog/concepts.ts")) await main();
