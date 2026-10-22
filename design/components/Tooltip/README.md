A tooltip names an icon-only button and its shortcut.

## Use
- `<span class="rj-tip" aria-hidden="true">` inside the `rj-btn` it describes, with an optional `<kbd class="rj-kbd rj-tip__kbd">` for the key: "Save S". In the app: the `Tooltip` in `apps/web/src/components/primitives/Button.tsx`, which `IconButton` adds for you from its `label` and `shortcut`.
- It opens below the button; `rj-tip--above` opens it above (for buttons at the bottom of a panel). The last button in a row opens it leftwards, so it never runs off the edge.
- The button itself carries the name (`aria-label`) and the key (`aria-keyshortcuts`), so the tooltip is hidden from screen readers.

## Rules
- Shows on hover after a 400ms pause, fading in over `duration-instant`; at once on keyboard focus.
- Set on `toast-bg` / `toast-fg` with `shadow-l2`, in `small`, on one line. It is out of the layout until shown, so a hidden one never widens the page.
- Touch screens have no hover, so they get no tooltip: the button's label must stand on its own.
- Only for icon-only buttons. A button with a visible label needs none.
