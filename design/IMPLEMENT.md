# Implementing the RawJobs design system

This folder is the source of truth for how RawJobs looks and behaves. Read `README.md` (the brand book) first, then this file.

> **In this repo** the kit is split in two. What the app ships lives in `apps/web/src/design/`: `tokens.json` (the source of truth), the generated `tokens.css` and `utilities.css`, `fonts/` and `logos/`. The references stay here in `/design`: this file, `README.md`, `components/` (previews, usage notes, `bundle.css`) and `screenshots/`. `pnpm design:build` regenerates the CSS from `tokens.json`; `pnpm check` fails if it is out of date. The app imports `components/bundle.css` from here as-is (in Tailwind's components layer), so the component CSS has one copy; the React primitives in `apps/web/src/components/primitives/` use its `rj-` classes, and `apps/web/design.html` (dev only) shows them all for comparison with `screenshots/`.

## What is here

| Path | What |
|---|---|
| `README.md` | Brand book: principles, voice, color, elevation, type, motion, interaction, logo. |
| `components/bundle.css` | The CSS for every component (`rj-` classes). The app imports it as-is. |
| `components/<Name>/README.md` | Usage rules per component. |
| `components/<Name>/preview.html` | Reference markup per component (structure, ARIA, states). |
| `apps/web/src/design/tokens.json` | Every token, 3 tiers (primitive, semantic, component), 4 themes. Source of truth. |
| `apps/web/src/design/tokens.css`, `utilities.css` | `tokens.json` compiled to CSS custom properties (plus `@font-face`) and to Tailwind utilities. Regenerate with `pnpm design:build`, never hand-edit. |
| `apps/web/src/design/fonts/` | Geist and Geist Mono woff2 files (SIL OFL, see `OFL.txt`). |
| `apps/web/src/design/logos/` | Outlined wordmark (ink, paper) and app mark SVGs. |
| `screenshots/` | How every component should look: `<theme>-<Name>.png` at 960px, `-390` at phone width. |

## Rules that are not negotiable

1. **Tokens only.** No hex, rgb or hsl literals in app code. Components use component tokens (`button-primary-bg`, `feed-row-hover`...), layouts use semantic tokens (`bg-canvas`, `text-secondary`...). Never reference primitives (`sand-*`, `orange-*`, `green-*`, `amber-*`, `red-*`) outside tokens.
2. **Four themes.** Set `data-theme` on `<html>` from `prefers-color-scheme` and `prefers-contrast` (snippet in README.md), with a user override in Settings (System, Light, Dark; "Increase contrast" toggle). Persist the override in localStorage.
3. **Never color alone.** Score bands and company health always show glyph + color + word/number.
4. **Type:** Geist 400/500/600 only, nothing under 12px, tabular figures for numbers, Geist Mono only for machine data (ATS names, slugs, CLI).
5. **Motion:** 100/150/200/300ms only (the few exceptions are listed in README.md, Motion), `transform`/`opacity` for movement, every animation respects `prefers-reduced-motion`.
6. **Keyboard:** visible `:focus-visible` ring everywhere, overlays trap and restore focus, shortcuts as listed in README.md.
7. **Copy:** follow the Voice section and the "One word per meaning" table. Verb-first buttons, sentence case, no em dashes, no emoji.

## As built

The kit went into the app in four phases, one PR each. All four are done; this is what each left behind.

- **Phase 1: Foundation.** `apps/web/src/design/` holds the tokens, fonts and logos. `pnpm design:build` (`scripts/design/tokens.ts`) compiles `tokens.json` and fails on a type style that shares a name with a `text-*` color or on a duplicate token; `pnpm check` runs it with `--check`. `apps/web/src/index.css` switches off Tailwind's own palette and scales and maps its theme to the semantic tokens. The theme is applied before first paint (`apps/web/index.html`, `apps/web/src/lib/theme.ts`).
- **Phase 2: Primitives.** `apps/web/src/components/primitives/` has the React versions of the `preview.html` files (Button and IconButton with its Tooltip, Chip, Field and SearchField, Kbd, Menu, ScoreBadge, ScoreBreakdown, SourceTag, Status, Tabs), on the `rj-` classes; the toast is `apps/web/src/components/Toast.tsx`. `apps/web/design.html` (dev only) shows them all.
- **Phase 3: Screens.** Radar, the job detail and drawer, Pipeline, Companies and Settings use the primitives. The screens have moved on since: the component READMEs describe them as they are now, and the shortcuts are listed in `README.md` (Interaction).
- **Phase 4: Verify.** `pnpm design:lint` (`scripts/design/lint.ts`) fails on color literals, primitive tokens, Tailwind's default palette, font sizes, radii and shadows, and similar slips in the app and site sources. `pnpm design:shots` screenshots the dashboard screens in each theme and width, and `--axe` adds an accessibility pass.

A few `bundle.css` classes have usage notes but no `preview.html`: `rj-tip` (an icon button's tooltip, `components/Tooltip/README.md`) and the scan's `rj-steps` and `rj-pulse` (`components/Loading/README.md`, next to `rj-progress`). `components/Cover/` is the kit's title card (name, tagline and a block illustration), not a component, so it has no README.

## Definition of done
All four themes work and follow the OS setting; every screen matches the reference screenshots; `pnpm design:lint` passes; `pnpm check` is green.
