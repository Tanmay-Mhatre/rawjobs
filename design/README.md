**Jobs, straight from the source.** RawJobs reads openings directly from companies' own hiring systems and scores them with rules anyone can read. The interface looks like what it is: source data, shown honestly. Unbleached paper, black ink, and one hot signal color that means "this is live, go now."

## Principles

1. **Data first.** Score, title and source are the design. Everything else steps back.
2. **Every number explains itself.** No score without a reachable Score breakdown; no count without the real numbers behind it.
3. **Never color alone.** Every state is a shape, a color and a word.
4. **Borders carry depth.** A 1px frame first, a soft shadow only on things that float.
5. **One accent.** Signal orange is about 10% of a screen at most. If everything is orange, nothing is new.
6. **Fast and calm.** Four durations, nothing over 300ms, nothing that loops except a loading shimmer.
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

- Buttons start with a verb and say what happens: "Scan now", "Apply on Lever", "Remove company". Never "OK", "Submit" or "Click here".
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

Every pair the CSS actually renders is checked in all four themes, 294 pairs in all:

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
- The 1.4s skeleton shimmer is the one exception to the four durations, and the only loop.
- Under `prefers-reduced-motion`, slides become fades and the loading shimmer stops.
- **The not-running exception.** The "RawJobs isn't running" window, the offline page and the 404 page (`packages/server/src/pages.ts`) tell a short story with pictures: RawJobs asleep and waking up (the cursor in its icon fills like a battery, the one place the cursor moves inside the product), the Desktop shortcut being double-clicked, a scan line finding no match. Each step keeps to the durations above; the story chains them over about 2 s, plays once, and shows its last frame under `prefers-reduced-motion`. The Start button fills like a progress bar while RawJobs starts (up to 20 s). Nothing else in the product does this.
- **Marketing pages** follow the same rules, with one documented exception: `duration-story` (380ms) for a step of a story the eye has to follow, used only by the hero's load and the "where your resume goes" route animation. Everything else on the site (row arrivals, reveals, bars, feedback) uses the four durations above, and nothing loops: example feeds tick a fixed number of times and stop.

## Interaction

- Focus: 2px `focus-ring` outline, 2px offset, on every interactive element, shown on `:focus-visible`.
- Overlays trap focus, close on `Esc`, and return focus to what opened them.
- Shortcuts: `J` / `K` move, `Enter` open, `S` save, `A` applied, `X` not interested, `C` copy description, `R` scan now, `/` search, `1`-`6` views, `[` / `]` move a pipeline card, `⌘K` commands, `?` help, `Esc` close.
- Touch targets are at least `control-lg` (44px) on touch screens: buttons, icon buttons, chips, tabs and menu items. Row actions are always visible on touch screens and phones.
- Lists are real lists (`ul` / `li`) under real headings; whatever sits behind an open drawer is `inert`.
- Loading: nothing under 100ms, keep old content up to 1s, skeleton rows up to 10s, per-source scan progress beyond.

## Iconography

Lucide at 16px with a 1.5 stroke, in `text-primary` or `text-secondary`. Icons sit next to a label; an icon-only button needs an `aria-label` and a tooltip naming its shortcut. The my-companies star is a filled Lucide star in the `star` token. Never emoji as icons, never hiring-system logos.

## Logo

**rawjobs** in lowercase Geist Mono, outlined, followed by a solid signal block cursor: a live feed, still streaming. Use `rawjobs-wordmark-ink.svg` on light grounds and `rawjobs-wordmark-paper.svg` on dark. The cursor on an ink square (`rawjobs-mark.svg`) is the app icon and favicon. Keep clear space equal to the cursor width on every side. Never recolor the cursor or animate it inside the product. The cursor is always `brand-signal`, in every theme, including increased contrast: it's a logo, so contrast rules don't apply. Interactive orange (the primary button, focus, the star, the new dot) uses the accent tokens, which follow the theme.

## Consuming

Load `tokens.css` and `components/bundle.css`, set `data-theme` on `<html>`, and use the `rj-` classes. Fonts ship in `fonts/` (Geist, SIL Open Font License, see `fonts/OFL.txt`). For Tailwind, map the semantic tokens, never the primitives:

```js
// tailwind.config.js
theme: { extend: { colors: {
  canvas: 'var(--bg-canvas)', raised: 'var(--bg-raised)', overlay: 'var(--bg-overlay)',
  ink: 'var(--text-primary)', muted: 'var(--text-secondary)',
  line: 'var(--border-default)', hairline: 'var(--border-subtle)',
  accent: { DEFAULT: 'var(--accent-solid)', text: 'var(--accent-text)' },
} } }
```
