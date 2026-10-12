import { SETTINGS_PAGES, SETTINGS_SECTIONS, type SettingsSection } from "./registry";

export type SettingsHit = {
  section: SettingsSection;
  /** "Your search › Profile" */
  path: string;
  /** Why it matched when the title doesn't say: "Your setting: Berlin", or "Matches “salary”". */
  why?: string;
  /** Set when the card isn't on this copy of RawJobs: the reason, shown instead of a link. */
  unavailable?: string;
};

type Options = {
  /** Cards this copy shows, and why one isn't shown. */
  unavailable?: (id: string) => string | undefined;
  /** What's saved in a card ("Berlin, Remote"), so "berlin" finds Locations. */
  values?: (id: string) => string[];
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "'");

/**
 * Settings cards that match every word typed, best first: a title match beats a page name, which beats
 * a synonym or one of your saved values. Runs in the browser; nothing typed leaves it.
 */
export function searchSettings(query: string, { unavailable, values }: Options = {}): SettingsHit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: (SettingsHit & { score: number; order: number })[] = [];
  SETTINGS_SECTIONS.forEach((section, order) => {
    const page = SETTINGS_PAGES.find((p) => p.id === section.page)!;
    const title = norm(section.title);
    const pageName = norm(page.label);
    const words = norm(section.words).split(" ");
    const saved = values?.(section.id) ?? [];
    let score = 0;
    let why: string | undefined;
    for (const t of terms) {
      if (title.startsWith(t) || title.split(" ").some((w) => w.startsWith(t))) score += 6;
      else if (title.includes(t)) score += 5;
      else if (pageName.includes(t)) score += 3;
      else if (words.some((w) => w.startsWith(t))) {
        score += 2;
        why ??= `Matches “${words.find((w) => w.startsWith(t))}”`;
      } else {
        const value = saved.find((v) => norm(v).includes(t));
        if (!value) return; // every word has to match somewhere
        score += 2;
        why = `Your setting: ${value}`;
      }
    }
    hits.push({ section, path: `${page.group} › ${page.label}`, why, unavailable: unavailable?.(section.id), score, order });
  });
  return hits.sort((a, b) => b.score - a.score || a.order - b.order).map(({ score: _s, order: _o, ...hit }) => hit);
}
