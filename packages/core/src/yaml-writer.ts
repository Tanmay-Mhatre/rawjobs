import type { CompanyRef, Config } from "./schema";

/** Strings and lists as JSON are valid YAML flow scalars, and JSON quoting is always safe. */
const q = (s: string) => JSON.stringify(s);
const list = (xs: readonly string[]) => `[${xs.map(q).join(", ")}]`;

function companyLine(c: CompanyRef): string {
  const parts = [`name: ${q(c.name)}`, `ats: ${c.ats}`, `slug: ${q(c.slug)}`];
  if (c.region && c.region !== "global") parts.push(`region: ${c.region}`);
  if (c.shard) parts.push(`shard: ${q(c.shard)}`);
  if (c.site) parts.push(`site: ${q(c.site)}`);
  if (c.careers_url) parts.push(`careers_url: ${q(c.careers_url)}`);
  if (!c.enabled) parts.push("enabled: false");
  return `  - { ${parts.join(", ")} }`;
}

/**
 * Config -> commented YAML, in the same layout as the shipped example, so a file written by
 * the setup wizard stays easy to read and hand-edit. Pure (no Node APIs) so the browser can use it too.
 */
export function configToYaml(config: Config): string {
  const p = config.profile;
  const keywords = Object.entries(p.keywords).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    "# RawJobs config. Written by the setup wizard; safe to edit by hand.",
    "# Check it with:  pnpm rawjobs validate",
    "",
    "profile:",
    `  name: ${q(p.name)}`,
    "",
    "  titles:",
    "    # A job's title must contain one of these (whole words, case-insensitive)...",
    `    include: ${list(p.titles.include)}`,
    "    # ...and none of these.",
    `    exclude: ${list(p.titles.exclude)}`,
    "",
    "  # +10 points when the title also contains one of these.",
    `  seniority_boost: ${list(p.seniority_boost)}`,
    "",
    "  locations:",
    "    # +20: the job is in one of these places.",
    `    include: ${list(p.locations.include)}`,
    "    # +15: remote roles you can take from where you live...",
    `    remote_ok: ${list(p.locations.remote_ok)}`,
    "    # ...unless the location also names a region you can't work from.",
    `    remote_exclude: ${list(p.locations.remote_exclude)}`,
    "    # Office jobs you'll take: onsite, hybrid. Empty = both.",
    `    workplace: ${list(p.locations.workplace ?? [])}`,
    "",
    "  # Industries you want to work in (ids from the setup's Industries step). Used to suggest companies.",
    `  industries: ${list(p.industries)}`,
    "",
    "  # Companies you've worked at. Used to suggest companies like them.",
    `  past_employers: ${list(p.past_employers ?? [])}`,
    "",
    "  # Matched as whole words in title + description. Weight 1 (nice) to 5 (core). Capped at 40 points.",
    keywords.length ? "  keywords:" : "  keywords: {}",
    ...keywords.map(([k, w]) => `    ${q(k)}: ${w}`),
    "",
    "  # Jobs scoring at least this count as strong matches (and trigger alerts).",
    `  min_score: ${p.min_score}`,
    "",
    "  # Dealbreakers. A job that breaks one stays on your Radar with the reason, at half its score and under min_score.",
    "  # Lowest base pay you'd take; a posted range topping out more than 5% under it breaks it.",
    p.salary_floor
      ? `  salary_floor: { amount: ${p.salary_floor.amount}, currency: ${q(p.salary_floor.currency)}, period: ${p.salary_floor.period} }`
      : '  # salary_floor: { amount: 85000, currency: "EUR", period: year }',
    '  # Countries you can work in without a visa sponsor ("eu" for the EU/EEA; ["none"] if you need one everywhere).',
    p.work_authorization?.length ? `  work_authorization: ${list(p.work_authorization)}` : '  # work_authorization: ["united kingdom"]',
    "  # Work you won't do: matched in the title, or said again and again in the description.",
    p.avoid?.length ? `  avoid: ${list(p.avoid)}` : '  # avoid: ["frontend", "credit risk"]',
    "",
    "# One line per company. Add more with:  pnpm rawjobs detect <careers url>",
    // An empty block would read back as null, so write an explicit empty list.
    config.companies.length ? "companies:" : "companies: []",
    ...config.companies.map(companyLine),
    "",
    '# Companies you never want to see ("ats:slug").',
    `companies_muted: ${list(config.companies_muted)}`,
    "",
    "# Old careers links you replaced with a new one, so they aren't suggested again.",
    `companies_replaced: ${list(config.companies_replaced)}`,
    "",
    "alerts:",
    `  telegram: ${config.alerts.telegram}`,
    `  email: ${config.alerts.email}`,
    `  only_new: ${config.alerts.only_new}`,
    "",
    "# The shared company directory (used for suggestions and Browse).",
    "directory:",
    "  # Download the latest directory when your copy is a week old.",
    `  auto_update: ${config.directory.auto_update}`,
    "  # Share companies you add by link (hiring system, slug and name only) so everyone's directory grows.",
    `  share_additions: ${config.directory.share_additions}`,
    "",
  ].join("\n");
}
