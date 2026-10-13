import { useEffect, useState } from "react";
import { DEFAULT_MAX_AGE_DAYS } from "./filters";
import { useSavedOnDisk } from "./tracking";

/**
 * The four RawJobs themes (design/README.md, "Themes and contrast"). They follow the system's
 * light/dark and increased-contrast settings unless you pick otherwise in Settings.
 * index.html runs the same resolution inline before first paint, so keep the two in step.
 */
export type ThemeChoice = "system" | "light" | "dark";
/** "more" always uses the increased contrast themes; "system" follows prefers-contrast. */
export type ContrastChoice = "system" | "more";
export type Theme = "light" | "dark" | "light-hc" | "dark-hc";

const THEME_KEY = "rawjobs.theme";
const CONTRAST_KEY = "rawjobs.contrast";
const CHANGED = "rawjobs:theme";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (value === "system") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // blocked storage: the choice lasts until the page closes
  }
}

const media = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;

export function themeChoice(): ThemeChoice {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function contrastChoice(): ContrastChoice {
  return read(CONTRAST_KEY) === "more" ? "more" : "system";
}

export function resolveTheme(theme = themeChoice(), contrast = contrastChoice()): Theme {
  const dark = theme === "system" ? media("(prefers-color-scheme: dark)") : theme === "dark";
  const more = contrast === "more" || media("(prefers-contrast: more)");
  return `${dark ? "dark" : "light"}${more ? "-hc" : ""}`;
}

export function applyTheme(): Theme {
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice);
  applyTheme();
  window.dispatchEvent(new Event(CHANGED));
}

export function setContrastChoice(choice: ContrastChoice): void {
  write(CONTRAST_KEY, choice);
  applyTheme();
  window.dispatchEvent(new Event(CHANGED));
}

/** Feed density (design/components/Feed): comfortable rows by default, compact on request. */
export type Density = "comfortable" | "compact";
const DENSITY_KEY = "rawjobs.density";

export function densityChoice(): Density {
  return read(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

export function setDensityChoice(d: Density): void {
  write(DENSITY_KEY, d === "comfortable" ? "system" : d);
  window.dispatchEvent(new Event(CHANGED));
}

/** The feed density, kept in step with Settings. */
export function useDensity(): Density {
  const [d, setD] = useState(densityChoice);
  useEffect(() => {
    const refresh = () => setD(densityChoice());
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return d;
}

/** How old a posting can be and still show on the Radar, in days; 0 shows every age. */
export const MAX_AGE_CHOICES = [30, 60, 90, 180, 0] as const;
export type MaxAge = (typeof MAX_AGE_CHOICES)[number];
const MAX_AGE_KEY = "rawjobs.maxAge";

export function maxAgeChoice(): MaxAge {
  const v = read(MAX_AGE_KEY);
  const n = v === null ? DEFAULT_MAX_AGE_DAYS : Number(v);
  return (MAX_AGE_CHOICES as readonly number[]).includes(n) ? (n as MaxAge) : DEFAULT_MAX_AGE_DAYS;
}

export function setMaxAgeChoice(days: MaxAge): void {
  write(MAX_AGE_KEY, days === DEFAULT_MAX_AGE_DAYS ? "system" : String(days));
  window.dispatchEvent(new Event(CHANGED));
}

/** The Radar's age limit, kept in step with Settings. */
export function useMaxAge(): MaxAge {
  const [d, setD] = useState(maxAgeChoice);
  useEffect(() => {
    const refresh = () => setD(maxAgeChoice());
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return d;
}

/**
 * Everything on this page that isn't a default, as saved in profile/tracking.json ("appearance").
 * The browser only remembers it for one address, and the dashboard's address changes when its port
 * does, so the file is what counts. Keys in a fixed order, so equal choices compare equal as JSON.
 */
export type Appearance = { theme?: "light" | "dark"; contrast?: "more"; density?: "compact"; maxAge?: MaxAge };

export function appearance(): Appearance {
  const theme = themeChoice();
  const maxAge = maxAgeChoice();
  return {
    ...(theme !== "system" ? { theme } : {}),
    ...(contrastChoice() === "more" ? { contrast: "more" as const } : {}),
    ...(densityChoice() === "compact" ? { density: "compact" as const } : {}),
    ...(maxAge !== DEFAULT_MAX_AGE_DAYS ? { maxAge } : {}),
  };
}

/** Take saved choices (anything unknown counts as the default) and show them at once. */
export function applyAppearance(saved: Appearance): void {
  write(THEME_KEY, saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system");
  write(CONTRAST_KEY, saved.contrast === "more" ? "more" : "system");
  write(DENSITY_KEY, saved.density === "compact" ? "compact" : "system");
  const age = (MAX_AGE_CHOICES as readonly unknown[]).includes(saved.maxAge) ? (saved.maxAge as MaxAge) : DEFAULT_MAX_AGE_DAYS;
  write(MAX_AGE_KEY, age === DEFAULT_MAX_AGE_DAYS ? "system" : String(age));
  applyTheme();
  window.dispatchEvent(new Event(CHANGED));
}

/** Keep the appearance choices in step with the file: once, in App. Does nothing on a hosted copy. */
export function useSavedAppearance(): void {
  const [value, setValue] = useState(appearance);
  useEffect(() => {
    const refresh = () => setValue(appearance());
    window.addEventListener(CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useSavedOnDisk<Appearance>("appearance", value, applyAppearance);
}

/** Your choices and the theme in use; follows the system while set to System. */
export function useTheme() {
  const [state, setState] = useState(() => ({ theme: themeChoice(), contrast: contrastChoice(), active: resolveTheme() }));
  useEffect(() => {
    const refresh = () => setState({ theme: themeChoice(), contrast: contrastChoice(), active: applyTheme() });
    const queries = ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"].map((q) => matchMedia(q));
    for (const q of queries) q.addEventListener("change", refresh);
    window.addEventListener(CHANGED, refresh);
    // Another tab changed it.
    window.addEventListener("storage", refresh);
    return () => {
      for (const q of queries) q.removeEventListener("change", refresh);
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return { ...state, setTheme: setThemeChoice, setContrast: setContrastChoice };
}
