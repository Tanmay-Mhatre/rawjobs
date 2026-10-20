/**
 * People from a LinkedIn people-search page you copied (Ctrl+A, Ctrl+C) and pasted. Pure, memory only.
 * Keeps 1st and 2nd connections; 3rd+ and "LinkedIn Member" are dropped.
 */

export type PastedPerson = {
  name: string;
  degree: 1 | 2;
  title?: string;
  location?: string;
  mutual?: { first: string; others: number };
};

export type PasteResult = {
  people: PastedPerson[];
  /** True when the paste had text but nothing LinkedIn writes in English ("2nd", "mutual connection", "View … profile"). */
  noEnglishMarkers: boolean;
};

export const PASTE_CAPS = { chars: 1_000_000, people: 100, line: 200 } as const;

type Degree = 1 | 2 | 3;
const DEGREE: Record<string, Degree> = { "1st": 1, "2nd": 2, "3rd": 3, "3rd+": 3 };

const STANDALONE = /^(?:[•·]\s*)?(1st|2nd|3rd\+?)$/i;
const DEGREE_LINE = /^(1st|2nd|3rd\+?)\s+degree connection$/i;
const INLINE = /^(.*?\S)\s*[•·]\s*(1st|2nd|3rd\+?)$/i;
const VIEW = /^View (.+?)[’']s?\s+profile$/i;
const MUTUAL_MANY = /^(.+?) and (\d+) other mutual connections?$/i;
const MUTUAL_TWO = /^(.+?) and (.+?) are mutual connections$/i;
const MUTUAL_ONE = /^(.+?) is a mutual connection$/i;
const ENGLISH = /\b(?:1st|2nd|3rd\+?)\b|mutual connection|degree connection|^View .+ profile$/im;

/** Buttons, status lines and the page's navigation: never a name, title or place. */
const NOISE_LINES = new Set(
  [
    "connect",
    "message",
    "follow",
    "following",
    "pending",
    "premium",
    "linkedin premium",
    "home",
    "my network",
    "jobs",
    "messaging",
    "notifications",
    "me",
    "for business",
    "search",
    "people",
    "filters",
    "all filters",
    "reset",
    "connections",
    "locations",
    "current company",
    "next",
    "previous",
    "out of network",
    "are these results helpful?",
    "your feedback helps us improve search results",
    "skip to main content",
  ].map((s) => s.toLowerCase()),
);

function isNoise(line: string): boolean {
  const l = line.toLowerCase();
  return (
    !line ||
    NOISE_LINES.has(l) ||
    VIEW.test(line) ||
    /^status is /i.test(line) ||
    /^(?:current|past|summary|skills):/i.test(line) ||
    /^\d+$/.test(line) ||
    /^(?:about )?[\d,]+ results?$/i.test(line) ||
    line.includes("•") ||
    line.includes("·")
  );
}

const isMarker = (line: string) => STANDALONE.test(line) || DEGREE_LINE.test(line);

function mutualOf(line: string): PastedPerson["mutual"] | undefined {
  let m = line.match(MUTUAL_MANY);
  if (m) return { first: m[1]!.slice(0, 120), others: Number(m[2]) };
  m = line.match(MUTUAL_TWO);
  if (m) return { first: m[1]!.slice(0, 120), others: 1 };
  m = line.match(MUTUAL_ONE);
  if (m) return { first: m[1]!.slice(0, 120), others: 0 };
  return undefined;
}

type Mark = { at: number; degree: Degree; name?: string; nameAt: number; end: number };

/** How far back from a degree marker the name may be. */
const NAME_REACH = 4;
/** How far after a marker its title, place and mutual line may be. */
const DETAIL_REACH = 10;

export function parsePeoplePaste(text: string): PasteResult {
  const input = text.slice(0, PASTE_CAPS.chars);
  const lines = input.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, " ").trim().slice(0, PASTE_CAPS.line));

  // 1. Degree markers, with an inline name ("Jane Doe • 2nd"). A repeat of the same degree right
  //    after ("• 2nd", then "2nd degree connection") is the same person.
  const marks: Mark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inline = !isMarker(line) && line.match(INLINE);
    const word = inline ? inline[2] : (line.match(STANDALONE) ?? line.match(DEGREE_LINE))?.[1];
    if (!word) continue;
    const degree = DEGREE[word.toLowerCase()]!;
    const prev = marks.at(-1);
    if (!inline && prev && prev.degree === degree && lines.slice(prev.end + 1, i).every(isNoise)) {
      prev.end = i;
      continue;
    }
    marks.push({ at: i, degree, nameAt: i, end: i, ...(inline ? { name: inline[1]!.trim() } : {}) });
  }

  // 2. Names: "View {name}'s profile" is the strongest anchor, else the nearest line before the marker that isn't noise.
  for (let k = 0; k < marks.length; k++) {
    const m = marks[k]!;
    if (m.name) continue;
    const floor = Math.max(k ? marks[k - 1]!.end + 1 : 0, m.at - NAME_REACH);
    let near: number | undefined;
    for (let i = m.at - 1; i >= floor; i--) {
      const line = lines[i]!;
      const view = line.match(VIEW);
      if (view) {
        m.name = view[1]!.trim();
        m.nameAt = near ?? i;
        break;
      }
      if (near === undefined && !isNoise(line) && !mutualOf(line) && !isMarker(line)) near = i;
    }
    if (!m.name && near !== undefined) {
      m.name = lines[near]!;
      m.nameAt = near;
    }
    // A doubled name line or a View line above it still belongs to this person, not the one before.
    for (let i = m.nameAt - 1; m.name && i >= floor; i--) {
      const line = lines[i]!;
      if (line === m.name || line.match(VIEW)?.[1]?.trim() === m.name) m.nameAt = i;
      else if (!isNoise(line)) break;
    }
  }

  // 3. Title, place and mutual line: after the marker, up to the next person's name.
  const people: PastedPerson[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < marks.length && people.length < PASTE_CAPS.people; k++) {
    const m = marks[k]!;
    const name = m.name?.slice(0, 120);
    if (m.degree === 3 || !name || isNoise(name) || name.toLowerCase() === "linkedin member") continue;
    const stop = Math.min(k + 1 < marks.length ? marks[k + 1]!.nameAt : lines.length, m.end + 1 + DETAIL_REACH);
    const person: PastedPerson = { name, degree: m.degree };
    const useful: string[] = [];
    for (let i = m.end + 1; i < stop; i++) {
      const line = lines[i]!;
      const mutual = mutualOf(line);
      if (mutual) person.mutual ??= mutual;
      else if (!isNoise(line) && !isMarker(line) && line !== name) useful.push(line);
    }
    if (useful[0]) person.title = useful[0].slice(0, 160);
    if (useful[1]) person.location = useful[1].slice(0, 120);
    const key = `${name}\n${person.title ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }

  return { people, noEnglishMarkers: !!input.trim() && !ENGLISH.test(input) };
}
