The job drawer shows one job in full without leaving the feed. In the app (`apps/web/src/components/JobDrawer.tsx`) it is used on phones and from the Pipeline; on wide screens the Radar shows the same job detail (`JobDetail.tsx`) in a pane beside the list instead.

## Use
- `rj-scrim` behind `rj-drawer` (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title). Inside: `rj-drawer__head` (source and close, title, meta), `rj-drawer__body` (Score breakdown, description in `body` at most `prose-max`), `rj-drawer__foot` (actions).
- In the app the drawer is a native `<dialog>` opened with `showModal()` (`apps/web/src/components/Dialog.tsx`), so the browser traps focus, makes the page behind it inert and draws the scrim as `::backdrop`.
- L3 surface: `drawer-bg`, `border-default` on the left edge, `shadow-l3`, over `scrim`. Width `drawer-width` (560px); full width under 720px.

## Rules
- Opens with a 24px slide and fade over `duration-base` / `ease-enter`; closes over `duration-quick` / `ease-exit`. Fades only under reduced motion.
- Focus moves to the drawer on open, is trapped inside, and returns to the row on close. `Esc` and the close button both close it.
- The feed behind is `inert` while the drawer is open, and its row stays marked with `aria-current`.
- On phones (under 720px) the drawer is full width, opens over `duration-slow`, and its footer stacks: the primary action full width, the rest in two 44px columns.
- Closing: set `data-state="closing"` on the drawer and scrim, wait for `animationend`, then remove them.
- Primary action is the real next step: "Apply at <company>" (for example "Apply at Stripe"), which opens the posting on the company's own site. An estimated job (scored on title, place and date only) says "Open careers page".
- `F` expands the job to a full-window reader (the "Expand to full window" button in the header, hidden on narrow screens), and `F` or `Esc` closes it again. `C` copies the description. Neither fires while you type.
