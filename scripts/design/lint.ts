/**
 * Keep app code on the design tokens (design/IMPLEMENT.md, "Rules that are not negotiable").
 * Tailwind v4 silently drops classes it doesn't know, so a stray `bg-blue-500` or `text-sm` would
 * build fine and render unstyled; this check makes them fail `pnpm check` instead.
 *
 *   pnpm design:lint
 *
 * Scans apps/web/src (except src/design, where the tokens live), apps/web/index.html, and the marketing
 * site's sources in apps/site/src, which are plain CSS: SITE_RULES add CSS-aware checks for them.
 * A line can opt out with a `design-lint-ignore` comment saying why.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WEB = join(ROOT, "apps/web");

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTIL = "bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|decoration|placeholder|caret|accent|shadow";

export const RULES: { id: string; pattern: RegExp; message: string }[] = [
  { id: "hex", pattern: /(?<!href=["'])(?<![\w&/])#[0-9a-fA-F]{3,8}\b(?![\w-])/, message: "Hex color: use a semantic token (bg-canvas, text-ink, border-line...)." },
  { id: "color-fn", pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/, message: "Color literal: use a semantic token." },
  { id: "primitive", pattern: /\b(?:sand|orange|green|amber|red)-\d{1,2}\b/, message: "Primitive token (sand-*, orange-*...): only semantic and component tokens may be used outside tokens.json." },
  {
    id: "palette",
    pattern: new RegExp(`\\b(?:${COLOR_UTIL})-(?:(?:${PALETTE})-\\d{2,3}|white|black)\\b`),
    message: "Tailwind's default palette is off: use a semantic color (canvas, raised, ink, muted, line, accent-text...).",
  },
  { id: "solid-text", pattern: /\btext-(?:accent|success|warning|danger)(?![\w-])/, message: "A solid fill color used as text: use the -text variant (text-accent-text, text-success-text...)." },
  {
    id: "old-color",
    pattern: /\b(?:bg|text|border(?:-[trblxy])?|ring|divide|fill|stroke|outline|from|to)-(?:bg|surface|surface-2|fg|line-strong|accent-soft|accent-fg|warn|warn-soft|bad|bad-soft|good)(?![\w-])/,
    message: "Pre-RawJobs color name: see the mapping in apps/web/src/index.css.",
  },
  { id: "text-size", pattern: /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/, message: "Tailwind font size: use a type style (type-small, type-label, type-meta, type-body...)." },
  { id: "radius", pattern: /\brounded(?:-[trblse]{1,2})?-(?:lg|xl|2xl|3xl|full)\b/, message: "Radius above 4px: use rounded-sm or rounded-md; only dots, radios and toggles use rounded-dot." },
  { id: "shadow", pattern: /\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)\b/, message: "Tailwind shadow: use shadow-l1, shadow-l2 or shadow-l3." },
  {
    id: "accent",
    pattern: /(?<![\w-])(?:[a-z-]+:)*(?:bg|border(?:-[trblxy])?|text|fill|stroke|ring|outline|divide|from|via|to|decoration|accent)-(?:accent(?:-subtle|-text|-border|-hover)?|on-accent)(?![\w-])/,
    message:
      "Orange is only for the primary button, the star, the new dot and the logo (design/README.md, One accent), which the primitives and kit classes already style. Selected, active and pressed states are ink.",
  },
  { id: "uppercase", pattern: /(?<![\w-])(?:[a-z-]+:)*uppercase(?![\w-])/, message: "No uppercase: headings are sentence case. Only source tags are uppercase, and the kit's rj-source styles them." },
];

/** Plain-CSS checks for the marketing site, where the Tailwind-class rules above can't see var(--…) and px. */
export const SITE_RULES: { id: string; pattern: RegExp; message: string }[] = [
  {
    id: "site-accent",
    pattern: /var\(--(?:accent-(?!mark\b)[a-z-]+|on-accent)\)/,
    message: "Orange is only for the primary button (the kit styles it), the star and new dot (accent-mark) and the logo (brand-signal).",
  },
  {
    id: "site-duration",
    pattern: /(?:transition|animation)[\w-]*\s*:[^;]*\b\d{3,}ms\b/,
    message:
      "Durations come from the motion tokens (duration-instant/quick/base/slow; duration-story for the hero and route animation; the site's cinematic layer adds duration-cinematic/reveal/marquee).",
  },
  { id: "site-font-px", pattern: /\bfont(?:-size)?\s*:[^;]*\b\d+(?:\.\d+)?px/, message: "Type sizes come from the type tokens (var(--text-…)), never px." },
];

export type Finding = { file: string; line: number; rule: string; message: string; text: string };

export function lintText(text: string, file: string, rules = RULES): Finding[] {
  const out: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes("design-lint-ignore")) return;
    for (const r of rules) if (r.pattern.test(line)) out.push({ file, line: i + 1, rule: r.id, message: r.message, text: line.trim().slice(0, 140) });
  });
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "design" && dir === join(WEB, "src") ? [] : files(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const SITE = join(ROOT, "apps/site/src");

function main(): number {
  const site = readdirSync(SITE)
    .filter((n) => /\.(html|js)$/.test(n))
    .map((n) => join(SITE, n));
  const targets = [...files(join(WEB, "src")), join(WEB, "index.html"), ...site];
  const findings = targets.flatMap((f) => lintText(readFileSync(f, "utf8"), relative(ROOT, f).replace(/\\/g, "/"), site.includes(f) ? [...RULES, ...SITE_RULES] : RULES));
  for (const f of findings) console.error(`${f.file}:${f.line}  [${f.rule}] ${f.message}\n    ${f.text}`);
  if (findings.length) {
    console.error(`\n${findings.length} design lint problem${findings.length === 1 ? "" : "s"}.`);
    return 1;
  }
  console.log(`design lint: ${targets.length} files clean`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
