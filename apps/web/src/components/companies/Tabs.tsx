import { useId, type ReactNode } from "react";
import { Tabs, type TabItem } from "../primitives";
import { cx } from "../ui";

export type { TabItem };

/**
 * Real ARIA tabs on the Tabs primitive (role=tablist/tab, aria-selected, roving tabindex, arrow/Home/End
 * keys, ink underline). Render the content with <TabPanel> using the same `ids`.
 */
export function useTabIds(prefix?: string) {
  const id = useId();
  const base = `${prefix ?? "tabs"}${id.replace(/:/g, "")}`;
  return { base, tab: (t: string) => `${base}-tab-${t}`, panel: (t: string) => `${base}-panel-${t}` };
}

export function TabList<T extends string>({
  tabs,
  value,
  onChange,
  label,
  ids,
  className,
  after,
  wrap,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (t: T) => void;
  label: string;
  ids: ReturnType<typeof useTabIds>;
  className?: string;
  /** Extra content after the tabs (outside the tablist), e.g. a spinner. */
  after?: ReactNode;
  /** Wrap onto a second line on narrow screens instead of scrolling sideways, so no tab is hidden. */
  wrap?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <Tabs label={label} items={tabs} value={value} onChange={onChange} idPrefix={`${ids.base}-tab`} panelId={ids.panel(value)} wrap={wrap} className="min-w-0 flex-1" />
      {after}
    </div>
  );
}

export function TabPanel({ id, ids, children, className }: { id: string; ids: ReturnType<typeof useTabIds>; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: ARIA tabs: the panel takes focus when it has no focusable content of its own
    <div role="tabpanel" id={ids.panel(id)} aria-labelledby={ids.tab(id)} tabIndex={0} className={cx("outline-none focus-visible:ring-2 focus-visible:ring-focus/40 rounded-md", className)}>
      {children}
    </div>
  );
}
