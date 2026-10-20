import { Building2, KanbanSquare, Radar as RadarIcon, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FAILING_HASH } from "../lib/companies";
import { type CardJob, parseCard } from "../lib/seePeople";
import { STEP_COUNT } from "../lib/setup";

/** The app's sections and the setup wizard, kept in the URL hash ("#pipeline", "#setup/2"). */
export const TABS = [
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
export type Tab = (typeof TABS)[number]["id"];
/** A section or setup step. "card" is the See people card's own popup window (main.tsx renders only the card). */
export type Route = { tab: Tab } | { setup: number } | { card: CardJob };
type PageRoute = Exclude<Route, { card: CardJob }>;

export function parseHash(): Route {
  // "#radar?posted=7…" carries the Radar's filters after the tab name; "#settings/scans" a Settings page.
  const raw = location.hash.slice(1);
  const q = raw.indexOf("?");
  const h = q < 0 ? raw : raw.slice(0, q);
  // "#card/<jobId>?t=…&c=…" carries the job's title and company, so the card needs no job list.
  const card = parseCard(h, q < 0 ? "" : raw.slice(q + 1));
  if (card) return { card };
  const m = h.match(/^setup(?:\/(\d))?$/);
  if (m) return { setup: Math.min(STEP_COUNT, Number(m[1] ?? 0)) };
  const tab = h.split("/")[0];
  return { tab: (TABS.some((t) => t.id === tab) ? tab : "radar") as Tab };
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((r: PageRoute) => {
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
