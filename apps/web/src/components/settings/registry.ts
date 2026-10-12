/**
 * Every Settings page and every card on it, in one list. The sidebar, the page routes
 * ("#settings/scans?section=schedule") and links from elsewhere in the app all read from here, so a new
 * setting is one entry. A card's id is also its element id (`settings-{id}`).
 */

export const SETTINGS_GROUPS = ["Your search", "Automation", "Preferences", "System"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const SETTINGS_PAGES = [
  { id: "profile", label: "Profile", group: "Your search", hint: "Who you're looking for. Changes apply after you save." },
  { id: "matching", label: "Matching", group: "Your search", hint: "How jobs are ranked, and which are hidden." },
  { id: "companies", label: "Companies", group: "Your search", hint: "Companies you'd love to work at." },
  { id: "scans", label: "Scans", group: "Automation", hint: "What RawJobs scans, and when." },
  { id: "notifications", label: "Notifications", group: "Automation", hint: "Where RawJobs tells you about new jobs." },
  { id: "appearance", label: "Appearance", group: "Preferences", hint: "How RawJobs looks in this browser." },
  { id: "data", label: "Data & privacy", group: "System", hint: "What leaves your computer, backups, and starting over." },
  { id: "updates", label: "Updates", group: "System", hint: "Which version you have, what's newer, and the desktop shortcut." },
  { id: "whats-new", label: "What's new", group: "System", hint: "What changed in each version." },
] as const satisfies readonly { id: string; label: string; group: SettingsGroup; hint: string }[];
export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

export type SettingsSection = { id: string; page: SettingsPageId; title: string };

/** Each card, in page order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "resume", page: "profile", title: "Master resume" },
  { id: "roles", page: "profile", title: "Roles" },
  { id: "locations", page: "profile", title: "Locations" },
  { id: "industries", page: "profile", title: "Industries" },
  { id: "keywords", page: "profile", title: "Topics" },
  { id: "dealbreakers", page: "profile", title: "Dealbreakers" },
  { id: "threshold", page: "matching", title: "Strong match threshold" },
  { id: "max-age", page: "matching", title: "Hide jobs older than" },
  { id: "rules", page: "matching", title: "Not interested rules" },
  { id: "companies", page: "companies", title: "My companies" },
  { id: "directory", page: "scans", title: "How scans work" },
  { id: "schedule", page: "scans", title: "Scheduled scans" },
  { id: "alerts", page: "notifications", title: "Telegram alerts" },
  { id: "theme", page: "appearance", title: "Theme" },
  { id: "density", page: "appearance", title: "Job list" },
  { id: "tracking", page: "data", title: "Your tracking data" },
  { id: "sharing", page: "data", title: "Sharing" },
  { id: "reset", page: "data", title: "Start setup over" },
  { id: "version", page: "updates", title: "RawJobs" },
  { id: "shortcut", page: "updates", title: "Desktop shortcut" },
  { id: "update", page: "updates", title: "Updates" },
  { id: "release-notes", page: "whats-new", title: "Release notes" },
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
