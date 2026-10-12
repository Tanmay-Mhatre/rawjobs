import { Building2, KanbanSquare, Radar as RadarIcon, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FAILING_HASH } from "../lib/companies";
import { STEP_COUNT } from "../lib/setup";

/** The app's sections and the setup wizard, kept in the URL hash ("#pipeline", "#setup/2"). */
export const TABS = [
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
export type Tab = (typeof TABS)[number]["id"];
export type Route = { tab: Tab } | { setup: number };

export function parseHash(): Route {
  // "#radar?posted=7…" carries the Radar's filters after the tab name.
  const h = location.hash.slice(1).split("?")[0]!;
  const m = h.match(/^setup(?:\/(\d))?$/);
  if (m) return { setup: Math.min(STEP_COUNT, Number(m[1] ?? 0)) };
  return { tab: (TABS.some((t) => t.id === h) ? h : "radar") as Tab };
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = "tab" in r ? r.tab : r.setup ? `setup/${r.setup}` : "setup";
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);
  const goStep = useCallback((n: number) => go(n > 0 ? { setup: n } : { setup: 0 }), [go]);
  /** "1 failing" and the failing banner: My companies, sorted by Needs attention. */
  const goFailing = useCallback(() => {
    location.hash = FAILING_HASH;
    setRoute({ tab: "companies" });
    window.scrollTo({ top: 0 });
  }, []);

  return { route, go, goStep, goFailing };
}
