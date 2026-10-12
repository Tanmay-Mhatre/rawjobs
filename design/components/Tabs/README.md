Tabs switch between views of the same list: All, My companies, New, Strong, Saved, Applied.

## Use
- `rj-tabs` (`role="tablist"`) with `rj-tab` buttons (`role="tab"`, `aria-selected`). Roving tabindex: the selected tab is `0`, the rest `-1`; arrow keys move, `1`-`6` jump.
- Each tab may carry an `rj-tab__count` in tabular figures.

## Rules
- The selected tab is marked by `tab-fg-selected` and a 2px `tab-indicator` underline, not by the accent color. Unselected tabs use `tab-fg`.
- On phones the row fades out at the right edge to show there is more.
- On narrow screens the row scrolls sideways inside itself; the page never does.
- `rj-tabs--wrap` (the `wrap` prop) wraps the row onto a second line instead: for a few long labels that must all stay visible on a phone, like the Companies page tabs and its kinds of suggestions. No edge fade then.
