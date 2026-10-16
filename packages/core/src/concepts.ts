import { BASE_CONCEPTS } from "./catalog/concepts";

/**
 * Topic matching by meaning: a topic counts when the posting names it, a word form of it ("forecast",
 * "forecasting"), or one of the words that prove it (catalog/concepts.ts: "PSP" proves "payments").
 * A mention right after a negation ("no crypto experience needed") doesn't count.
 * No AI here: a fixed word list, updated weekly by an automatic workflow (setConcepts).
 */

/** What the weekly concepts workflow publishes: more words per topic, on top of BASE_CONCEPTS. */
export type ConceptsFile = { version: string; concepts: Record<string, string[]> };

const key = (topic: string) => topic.toLowerCase().trim();
let table = new Map<string, string[]>();
let version = "base";
const regexes = new Map<string, RegExp>();

function build(extra?: ConceptsFile["concepts"]): void {
  table = new Map(Object.entries(BASE_CONCEPTS).map(([t, a]) => [key(t), [...a]]));
  for (const [t, aliases] of Object.entries(extra ?? {})) {
    const k = key(t);
    const have = table.get(k) ?? [];
    const seen = new Set(have.map((a) => a.toLowerCase()));
    table.set(k, [...have, ...aliases.filter((a) => !seen.has(a.toLowerCase()) && a.toLowerCase() !== k)]);
  }
  regexes.clear();
}
build();

/** Use the weekly word list (or go back to the built-in one with none). */
export function setConcepts(file?: ConceptsFile): void {
  build(file?.concepts);
  version = file?.version ?? "base";
}

/** Which word list scored a job: "base", or the weekly file's version. */
export const conceptsVersion = () => version;

/** The words that prove a topic, besides the topic itself. */
export function aliasesOf(topic: string): readonly string[] {
  return table.get(key(topic)) ?? [];
}

/** Every topic and word the list knows: what makes a must-have line checkable. */
export function knownConceptTerms(): string[] {
  return [...table.entries()].flatMap(([t, a]) => [t, ...a]);
}

/** Words whose other forms mean something else: "securities" are bonds and shares, "futures" contracts, "goods" products. */
const FIXED_FORMS = new Set(["security", "securities", "future", "futures", "good", "goods", "custom", "customs", "news", "arts", "physic", "physics"]);

/** Word forms of a topic's last word: "forecast" -> forecasts, forecasting, forecasted; "pricing" -> price, prices. */
function formsPattern(term: string): string {
  const words = term
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const last = words.pop() ?? "";
  let tail = last;
  if (/^[a-z]{4,}$/i.test(last) && !FIXED_FORMS.has(last.toLowerCase())) {
    if (/(?:ies|[^aeiou]y)$/i.test(last)) tail = `${last.replace(/(?:ies|y)$/i, "")}(?:y|ies)`;
    else {
      // "process", "analysis", "status" keep their s; "payments", "forecasting", "pricing" lose the ending.
      const base = /(?:ss|us|is)$/i.test(last) ? last : last.replace(/(?:ings|ing|ed|es|s|e)$/i, "");
      if (base.length >= 4) tail = `${base}(?:e|es|s|ing|ings|ed)?`;
    }
  }
  return [...words, tail].join("[\\s\\-]+");
}

/** A one-word alias with a capital (PSP, React, Kafka) matches only as written: "react quickly" isn't React. */
function regexFor(term: string, asWritten: boolean): RegExp {
  const k = `${asWritten ? "=" : "~"}${term}`;
  let re = regexes.get(k);
  if (!re) {
    if (regexes.size > 20_000) regexes.clear();
    regexes.set(k, (re = new RegExp(`(?<![\\p{L}\\p{N}])${formsPattern(term)}(?![\\p{L}\\p{N}])`, asWritten ? "gu" : "giu")));
  }
  return re;
}
const asWritten = (alias: string) => !/\s/.test(alias.trim()) && /\p{Lu}/u.test(alias);

/** "no", "not", "without"… just before a mention: "no prior crypto experience needed" doesn't count. */
const NEGATION = /(?:^|[^\p{L}])(?:no|not|without|never|nor|non)(?:[^\p{L}]+[\p{L}'’-]+){0,2}[^\p{L}]*$/iu;

function count(text: string, term: string, exact: boolean, cap: number): number {
  let n = 0;
  for (const m of text.matchAll(regexFor(term, exact))) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (NEGATION.test(before)) continue;
    if (++n >= cap) break;
  }
  return n;
}

/**
 * How many times a text names a topic (up to `cap`): the topic and its word forms first, then the words
 * that prove it. `via` is the word that matched when the topic itself isn't there ("PSP" for payments).
 */
export function topicMentions(text: string, topic: string, cap = Infinity): { n: number; via?: string } {
  if (!text) return { n: 0 };
  const own = count(text, topic, false, cap);
  if (own) return { n: own };
  for (const alias of aliasesOf(topic)) {
    const n = count(text, alias, asWritten(alias), cap);
    if (n) return { n, via: alias };
  }
  return { n: 0 };
}

/** Does the text name the topic (or a word that proves it)? */
export const namesTopic = (text: string, topic: string) => topicMentions(text, topic, 1).n > 0;
