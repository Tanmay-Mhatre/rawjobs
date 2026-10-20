/**
 * Every Settings page and every card on it, in one list. The sidebar, the page routes
 * ("#settings/scans?section=schedule") and links from elsewhere in the app all read from here, so a new
 * setting is one entry. A card's id is also its element id (`settings-{id}`).
 */

export const SETTINGS_GROUPS = ["Your search", "Automation", "Preferences", "System"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const SETTINGS_PAGES = [
  { id: "profile", label: "Profile", group: "Your search", hint: "Who you're looking for. Changes wait for Save; Save & scan uses them right away." },
  { id: "matching", label: "Matching", group: "Your search", hint: "How jobs are ranked, and which are hidden." },
  { id: "companies", label: "Companies", group: "Your search", hint: "Companies you'd love to work at." },
  { id: "scans", label: "Scans", group: "Automation", hint: "What RawJobs scans, and when. Changes save right away." },
  { id: "notifications", label: "Notifications", group: "Automation", hint: "Where RawJobs tells you about new jobs and what's due today. Changes save right away." },
  { id: "appearance", label: "Appearance", group: "Preferences", hint: "How RawJobs looks." },
  { id: "keyboard", label: "Keyboard", group: "Preferences", hint: "Every shortcut in RawJobs." },
  { id: "data", label: "Data & privacy", group: "System", hint: "What leaves your computer, backups, and starting over. Changes save right away." },
  { id: "updates", label: "Updates", group: "System", hint: "Which version you have, what's newer, and the desktop shortcut." },
  { id: "whats-new", label: "What's new", group: "System", hint: "What changed in each version." },
] as const satisfies readonly { id: string; label: string; group: SettingsGroup; hint: string }[];
export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

/** A card. `words` are what people might type for it besides its title: synonyms and the controls on it. */
export type SettingsSection = { id: string; page: SettingsPageId; title: string; words: string };

/** Each card, in page order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "resume", page: "profile", title: "Master resume", words: "cv pdf upload paste file several resumes merge" },
  { id: "roles", page: "profile", title: "Roles", words: "job titles title role family exclude seniority senior junior level position" },
  { id: "locations", page: "profile", title: "Locations", words: "places city cities country office remote regions relocate where hybrid onsite" },
  { id: "industries", page: "profile", title: "Industries", words: "sector domain field market" },
  { id: "keywords", page: "profile", title: "Topics", words: "keywords skills boost rank interests technologies tech stack" },
  { id: "dealbreakers", page: "profile", title: "Dealbreakers", words: "salary pay money minimum compensation visa sponsorship work authorization permit avoid" },
  { id: "threshold", page: "matching", title: "Strong match threshold", words: "score minimum min score highlight good match best" },
  { id: "max-age", page: "matching", title: "Hide jobs older than", words: "old stale age posted date fresh months" },
  { id: "rules", page: "matching", title: "Not interested rules", words: "hide hidden not for me filter mute dismiss" },
  { id: "companies", page: "companies", title: "My companies", words: "favourite favorite starred dream target employers hidden muted" },
  { id: "scope", page: "scans", title: "What to scan", words: "scope all companies my companies only industries rank boost background check scan now how long" },
  { id: "schedule", page: "scans", title: "Scheduled scans", words: "automatic daily time times timer cron run now" },
  { id: "check-all", page: "scans", title: "Check every company now", words: "all companies whole directory full scan every company" },
  { id: "directory", page: "scans", title: "Company directory", words: "catalog background update startup list" },
  { id: "alerts", page: "notifications", title: "Telegram alerts", words: "phone push mobile bot message notify notification test connect disconnect" },
  { id: "daily", page: "notifications", title: "Daily summary", words: "today tasks morning digest reminder pipeline follow-ups interviews thank-you offer deadline time" },
  { id: "send", page: "notifications", title: "What to send", words: "only new strong matches every time update ready version message" },
  { id: "theme", page: "appearance", title: "Theme", words: "dark mode light night colour color contrast accessibility" },
  { id: "density", page: "appearance", title: "Job list", words: "density compact comfortable spacing rows" },
  { id: "shortcuts", page: "keyboard", title: "Keyboard shortcuts", words: "hotkeys keys keybindings shortcut" },
  { id: "tracking", page: "data", title: "Your tracking data", words: "backup export import move device transfer json notes statuses saved views" },
  { id: "sharing", page: "data", title: "Sharing", words: "privacy share send directory contribute companies added by link update careers link moved" },
  { id: "tips", page: "data", title: "Tips you've closed", words: "dismissed notices checklist hints show again reset" },
  { id: "reset", page: "data", title: "Start setup over", words: "reset wizard clear restart onboarding danger zone" },
  { id: "version", page: "updates", title: "RawJobs", words: "version about check for updates install upgrade" },
  { id: "shortcut", page: "updates", title: "Desktop shortcut", words: "icon start menu address bookmark" },
  { id: "update", page: "updates", title: "Updates", words: "watch new versions beta channel upgrade" },
  { id: "release-notes", page: "whats-new", title: "Release notes", words: "changelog what's new whats new changes history versions" },
];

/** Links made before Settings had pages pointed at a group ("#settings?section=scans"): where each one lives now. */
const OLD_GROUPS: Record<string, SettingsPageId> = {
  "my-companies": "companies",
  about: "updates",
};

const isPage = (id: string | null | undefined): id is SettingsPageId => !!id && SETTINGS_PAGES.some((p) => p.id === id);
const sectionById = (id: string | null | undefined) => (id ? SETTINGS_SECTIONS.find((s) => s.id === id) : undefined);

/**
 * The page and card a Settings hash points at: "#settings/scans?section=schedule". An older link without the
 * page ("#settings?section=schedule") finds the page from the card. `page` is null for a bare "#settings".
 */
export function parseSettingsHash(hash: string): { page: SettingsPageId | null; section: string | null } {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const fromPath = path.split("/")[1];
  const section = new URLSearchParams(query).get("section");
  if (isPage(fromPath)) return { page: fromPath, section };
  // An old group link, or a page named as a section.
  if (section && (isPage(section) || section in OLD_GROUPS)) return { page: isPage(section) ? section : OLD_GROUPS[section]!, section: null };
  return { page: sectionById(section)?.page ?? null, section };
}

/** The hash for a page, or a card on it: settingsHash("schedule") is "settings/scans?section=schedule". */
export function settingsHash(to: SettingsPageId | string): string {
  if (isPage(to) && !sectionById(to)) return `settings/${to}`;
  const s = sectionById(to);
  return s ? `settings/${s.page}?section=${s.id}` : "settings";
}
