Tabs switch between views of one thing: the Companies page (My companies, Suggestions, Browse all) and its kinds of suggestions, a tracked job's Activity, People, Interviews and Job (Details in the wide view), and the kinds of referral message. The Radar has no tabs: its quick filters are chips (`apps/web/src/components/radar/ViewsBar.tsx`).

## Use
- `rj-tabs` (`role="tablist"`) with `rj-tab` buttons (`role="tab"`, `aria-selected`, `aria-controls` the panel). Roving tabindex: the selected tab is `0`, the rest `-1`; the arrow keys, `Home` and `End` move and select. In the app: the `Tabs` primitive (`apps/web/src/components/primitives/Tabs.tsx`).
- Each tab may carry an `rj-tab__count` in tabular figures, or a check in its place when the list is done.

## Rules
- The selected tab is marked by `tab-fg-selected` and a 2px `tab-indicator` underline, not by the accent color. Unselected tabs use `tab-fg`.
- On phones the row fades out at the right edge to show there is more.
- On narrow screens the row scrolls sideways inside itself; the page never does.
- `rj-tabs--wrap` (the `wrap` prop) wraps the row onto a second line instead: for a few long labels that must all stay visible on a phone, like the Companies page tabs, its kinds of suggestions and the referral message kinds. No edge fade then.
