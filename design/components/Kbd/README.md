A kbd shows a keyboard shortcut next to the action it triggers.

## Use
- `<span class="rj-kbd">S</span>`, one element per key. Set in the `kbd` style (Geist Mono 12px) in `kbd-fg` on `kbd-bg`, with a `kbd-border` that is 1px thicker at the bottom.
- Show shortcuts in tooltips, menus, the search field and the `?` shortcut sheet. Never as decoration.

## RawJobs shortcuts
`J` / `K` next / previous job · `Enter` open · `S` save · `A` mark as applied · `X` not interested · `C` copy description · `F` expand the job to the full window · `R` scan now · `/` search · `1`-`3` Radar quick filters · `1`-`4` switch section outside the Radar · `G` then `R` / `P` / `C` / `S` go to a section · `[` / `]` move a pipeline card · `?` show the shortcuts · `Esc` close.

The list in the app is `shortcutRows` in `apps/web/src/components/ShortcutList.tsx`; keep this line in step with it.
