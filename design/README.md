**Jobs, straight from the source.** RawJobs reads openings directly from companies' own hiring systems and scores them with rules anyone can read. The interface looks like what it is: source data, shown honestly. Unbleached paper, black ink, and one hot signal color that means "this is live, go now."

## Principles

1. **Data first.** Score, title and source are the design. Everything else steps back.
2. **Every number explains itself.** No score without a reachable Score breakdown; no count without the real numbers behind it.
3. **Never color alone.** Every state is a shape, a color and a word.
4. **Borders carry depth.** A 1px frame first, a soft shadow only on things that float.
5. **One accent.** Signal orange is about 10% of a screen at most. If everything is orange, nothing is new.
6. **Fast and calm.** Four durations, nothing over 300ms, and nothing loops except something that shows work in progress (see Motion).
7. **Keyboard first.** Everything works without a mouse, and focus is always visible.

## Voice

Plain, specific, a little dry. Show the number, skip the hype. Write to "you"; the interface never says "we".

| Say | Don't say |
|---|---|
| Posted 2 days ago on Greenhouse | Hot new opportunity! |
| 74: title 30, place 20, keywords 14, industry 10 | Great match for you |
| No jobs matched this scan. Adding Dubai would show 23 more. | Oops! Nothing here yet. |
| This board returned no jobs. Check the link or try the company's main careers page. | Invalid URL |
| Runs on your machine. Nothing is sent anywhere. | Enterprise-grade privacy |
| Scanned 214 companies. 9 new for you. | Your personalized feed is ready! |

- Buttons start with a verb and say what happens: "Scan now", "Apply at Stripe", "Remove company". Never "OK", "Submit" or "Click here".
- Sentence case everywhere. No emoji. No em dashes; use a period or a colon.
- Words to own: **source, live, raw, direct, first.** Words to avoid: AI-powered, smart, seamless, revolutionize, dream job.
- Taglines: **"Jobs, straight from the source."** Subline: **"See it before LinkedIn does."**

### One word per meaning

| Word | Means | Never call it |
|---|---|---|
| New | first seen in the latest scan (the dot) | live, fresh |
| Fetched | the full posting was read and scored | checked live |
| Estimated | scored on title, place and date only | approximate, preview |
| Healthy, Dormant, Broken link | a company's board status | live, dead, error |
| Not interested | hide this one job | dismiss, remove |
| Hide company | never show or check this company | block, mute |
| Remove company | take it off my companies | delete, unfollow |
| Title, place, keywords, industry | the four score factors | location, sector |

## Color

### Three tiers

Components never touch a hex value or a primitive.

| Tier | Example | Who uses it |
|---|---|---|
| Primitive | `orange-9`, `sand-11` | Only semantic tokens |
| Semantic | `accent-solid`, `text-secondary`, `bg-raised` | Page layout and components |
| Component | `button-primary-bg`, `score-strong-bg`, `feed-divider` | Only that component's CSS |

### Scales

Five 12-step scales built in OKLCH, so each step means the same thing in every hue and theme:

| Steps | Job |
|---|---|
| 1-2 | Page and panel grounds |
| 3-5 | Hover, pressed and tinted fills |
| 6-8 | Borders, from hairline to strong |
| 9-10 | Solid fills and their hover |
| 11 | Secondary and colored text |
| 12 | Primary text |

`sand` is the warm neutral, `orange` the signal (step 9 is `#ff5a1f`), `green` strong and healthy, `amber` fair and dormant, `red` errors and broken links.

### Using the semantic tokens

- Page ground `bg-canvas` (L0). Panels, the feed, kanban columns `bg-raised` (L1) framed in `border-default`. Menus and the drawer `bg-overlay` (L2, L3).
- Text is `text-primary` or `text-secondary`, on any `bg-*` token. `text-disabled` is for disabled labels only.
- Hairlines between rows are `border-subtle`. Anything that identifies a control (inputs, secondary buttons, weak score outlines) uses `border-control`.
- Signal: `accent-solid` fills the primary button and the logo cursor; text on it is `on-accent`. The my-companies star and the new-this-scan dot use `accent-mark`, a deeper orange in light so they hold 3:1 on hover and selected rows. Links and accent text use `accent-text`.
- Status: `success-*` for strong matches and healthy boards, `warning-*` for fair matches and dormant boards, `danger-*` for errors and broken links. Each has `-solid`, `-text`, `-subtle` and `on-*`.
- Destructive buttons are outlined in `danger-text` with no fill. `danger-solid` is only for small glyphs.

### Budget

About 60% `bg-canvas`, 30% structure (`bg-raised` panels, frames, nav), 10% accent and status. Measure it on a screenshot, not in code.

### Themes and contrast

Four themes: **Light**, **Dark**, **Light, increased contrast** and **Dark, increased contrast**. Pick them from the viewer's settings:

```js
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const more = matchMedia('(prefers-contrast: more)').matches;
document.documentElement.dataset.theme = (dark ? 'dark' : 'light') + (more ? '-hc' : '');
```

The colors were audited once, when the kit was made, for every text and border pair the CSS renders, in all four themes, against these targets. No script re-checks them: when you change a color token, check its pairs again by hand. `pnpm design:shots --axe` runs axe (WCAG 2 A and AA, which includes text contrast) over the dashboard screenshots.

- Primary text at least 7:1 (WCAG 2) and APCA Lc 90 on the main grounds.
- Secondary, accent and status text at least 4.5:1 and Lc 60; 7:1 in increased contrast.
- Labels on solid fills at least 4.5:1; the focus ring, control borders, star, dot, selection bar and breakdown outline at least 3:1 on every surface they touch.
- One known trade-off: dark ink on the signal fill is 5.9:1 (WCAG AA) but only APCA Lc 46, below APCA's guidance for 14px labels. We keep the brand orange there; the increased contrast themes swap in a fill that reaches 7:1.
- Increased contrast themes darken (or brighten) step 11, raise every border to 3:1, drop shadows, and move the signal fill to a deep orange with light text (light) or a light orange with dark text (dark), so every label reaches 7:1.

## Elevation

| Level | Surface | Border | Shadow |
|---|---|---|---|
| L0 | `bg-canvas`: the page | none | none |
| L1 | `bg-raised`: feed, cards, columns, sidebars | `border-default` | `shadow-l1` (dark: a top-edge highlight) |
| L2 | `bg-overlay`: menus, popovers, kanban cards | `border-default` | `shadow-l2` |
| L3 | `bg-overlay` over `scrim`: drawer, command menu | `border-default` | `shadow-l3` |

Light-mode shadows stay under 8% opacity. A list is never bare text on the canvas: it always sits in an L1 panel with hairline dividers.

## Type

- **Geist** for the interface, weights 400, 500 and 600 only. **Geist Mono** only for what came from a machine: hiring system names, slugs, URLs, keys, CLI.
- Dashboard sizes follow a Major Second scale from a 16px body: `title` 24, `heading` 20, `subheading` 18, `body` and `body-strong` 16, `small` and `label` 14, `meta` 12. Nothing smaller than 12px, and 12px is never primary content: help and error text are 14px.
- Type styles compile to `--text-<style>` font shorthands, so no style may share a name with a `text-*` color token. The token build fails if one does.
- Sizes are written in px in `tokens.json` and compiled to rem, so text grows with the reader's browser font size.
- Marketing pages add `display-xl` (the hero headline only, 40 to 88px), `display` (36 to 48px: the closing headline and big numbers), `section` (28 to 40px section headings) and `lede` (20px). They scale with the window and never appear in the dashboard.
- Scores, counts and dates use tabular figures (`font-variant-numeric: tabular-nums`) so columns line up.
- Running text stops at `prose-max` (70ch). Headings get `text-wrap: balance`.

## Layout and spacing

- 8px grid for layout (`space-2`, `space-4`, `space-6`, `space-8`), 4px steps inside components (`space-1`, `space-3`).
- Page gutter `space-8` on desktop, `space-4` on phones. Panels `space-4` inside, the drawer `space-6`.
- Feed density: comfortable (`row-pad-comfortable`, default) or compact (`row-pad-compact`), a setting on `data-density`.
- Works from 375px to 1280px and up. The page never scrolls sideways; tabs, boards and tables scroll inside themselves.
- Radius: `radius-0` for data rows and bars, `radius-sm` for badges and chips, `radius-md` for controls and panels. Only the new-this-scan dot is round.

## Motion

- Durations: `duration-instant` (100ms) feedback, `duration-quick` (150ms) exits, `duration-base` (200ms) enters, `duration-slow` (300ms) phone drawer only.
- Easing: `ease-enter` for things arriving, `ease-exit` for things leaving, `ease-standard` for color and opacity on the spot. No bounce, no elastic.
- Movement uses `transform` and `opacity` only. State changes (hover, press, selection) may change color and border color, at `duration-instant`.
- Exits: set `data-state="closing"` on the drawer, scrim, menu or toast and remove it on `animationend`.
- Only things that show work in progress loop, and none of them is held to the four durations: the 1.4s skeleton shimmer, the scan progress bar's sweep while the total isn't known yet and the pulsing dot next to "Last checked" (both 1.6s, `rj-progress__track--sweep` and `rj-pulse`), and spinners.
- Under `prefers-reduced-motion`, slides become fades and the shimmer, sweep and pulse stop.
- **The not-running exception.** The "RawJobs isn't running" window, the offline page and the 404 page (`packages/server/src/pages.ts`, shared with `apps/web/src/components/ServerDown.tsx`) tell a short story with pictures: RawJobs asleep and waking up, the Desktop shortcut being double-clicked, a scan line finding no match. This is the one place the logo's cursor moves inside the product: in RawJobs' icon it fills like a battery, slowly while RawJobs starts (up to 12 s) and in `duration-slow` once it's running. The Desktop story chains steps in the motion tokens plus `duration-story` (380ms) for the pointer's move, over about 2 s, and plays once. The Start button fills like a progress bar while RawJobs starts (up to 20 s), and the step being worked on shows a spinner. Under `prefers-reduced-motion` each picture shows its last frame. Nothing else in the product does this.
- **Marketing pages** (`apps/site`) follow the same rules, with documented exceptions:
  - `duration-story` (380ms) for a step of a story the eye has to follow: the hero's load, its wall scan and the "where your resume goes" route animation.
  - The site-only cinematic layer at the end of the page's styles (`apps/site/README.md`) adds `--duration-cinematic` (700ms) for reveals, bars and gauges, `--duration-reveal` (1200ms) for the slowest arrivals, and its own easing. The dashboard never loads it.
  - A few things loop: the blinking caret in the install steps' mock screen, the hiring systems marquee (it pauses on hover), the hero radar's sweep (every 6 s, paused off screen and in background tabs) and the slow radar sweep behind the closing call. The intro's logo cursor blinks once.
  - Demos (the typed intro, the install steps' terminal) play a fixed number of steps and stop. Under `prefers-reduced-motion` every loop stops and each scene shows its end state.

## Interaction

- Focus: 2px `focus-ring` outline, 2px offset, on every interactive element, shown on `:focus-visible`.
- Overlays trap focus, close on `Esc`, and return focus to what opened them.
- Shortcuts (the list is `shortcutRows` in `apps/web/src/components/ShortcutList.tsx`, shown by `?` and on Settings › Keyboard): `J` / `K` next / previous job, `Enter` open, `S` save, `A` mark as applied, `X` not interested, `C` copy description, `F` expand the job to the full window, `R` scan now, `/` search, `1`-`3` the Radar's quick filters (My companies, New, Strong, each on or off), `1`-`4` switch section outside the Radar, `G` then `R` / `P` / `C` / `S` go to Radar, Pipeline, Companies or Settings, `[` / `]` move a pipeline card back / forward, `?` show the shortcuts, `Esc` close. Single keys never fire while you type, or with Ctrl, Cmd or Alt held.
- Touch targets are at least `control-lg` (44px) on touch screens: buttons, icon buttons, chips, tabs and menu items. Row actions are always visible on touch screens and phones.
- Lists are real lists (`ul` / `li`) under real headings; whatever sits behind an open drawer is `inert`.
- Loading: nothing under 100ms, keep old content up to 1s, skeleton rows up to 10s, per-source scan progress beyond.

## Iconography

Lucide at 16px with a 1.5 stroke, in `text-primary` or `text-secondary`. Icons sit next to a label; an icon-only button needs an `aria-label` and a tooltip naming its shortcut. The my-companies star is a filled Lucide star in the `star` token. Never emoji as icons, never hiring-system logos.

## Logo

**rawjobs** in lowercase Geist Mono, outlined, followed by a solid signal block cursor: a live feed, still streaming. Use `rawjobs-wordmark-ink.svg` on light grounds and `rawjobs-wordmark-paper.svg` on dark. The cursor on an ink square (`rawjobs-mark.svg`) is the app icon and favicon. Keep clear space equal to the cursor width on every side. Never recolor the cursor. Never animate it inside the product, except the battery fill on the not-running pages (see Motion); on the marketing site the intro may blink it. The cursor is always `brand-signal`, in every theme, including increased contrast: it's a logo, so contrast rules don't apply. Interactive orange (the primary button, focus, the star, the new dot) uses the accent tokens, which follow the theme.

## Consuming

Load `apps/web/src/design/tokens.css` and `design/components/bundle.css`, set `data-theme` on `<html>`, and use the `rj-` classes. The fonts ship in `apps/web/src/design/fonts/` (Geist, SIL Open Font License, see `OFL.txt` there) and the logos in `apps/web/src/design/logos/`. Tokens are written in `apps/web/src/design/tokens.json`; `pnpm design:build` compiles them to `tokens.css` and `utilities.css`.

The dashboard uses Tailwind 4. `apps/web/src/index.css` switches Tailwind's own palette and scales off and maps its theme to the semantic tokens only, never the primitives, for example:

```css
@theme inline reference {
  --color-canvas: var(--bg-canvas);
  --color-raised: var(--bg-raised);
  --color-ink: var(--text-primary);
  --color-muted: var(--text-secondary);
  --color-line: var(--border-default);
}
```
