// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForYou } from "../src/components/companies/ForYou";
import { SuggestionCard } from "../src/components/companies/SuggestionCard";
import { openingLens } from "../src/components/companies/SuggestSkeleton";
import { type CompanySuggestion, type CompanySuggestions, MATCH_MS_KEY, matchEstimate, type SuggestState, useCompanySuggestions } from "../src/lib/companySuggest";
import { type Draft, emptyDraft } from "../src/lib/setup";

const co = (name: string, patch: Partial<CompanySuggestion> = {}): CompanySuggestion => {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return {
    key: `greenhouse:${slug}`,
    name,
    ats: "greenhouse",
    slug,
    careers_url: `https://job-boards.greenhouse.io/${slug}`,
    open_jobs: 10,
    score: 50,
    matches: 1,
    new_matches: 0,
    near_misses: 0,
    elsewhere: 0,
    in_your_places: 0,
    examples: [],
    topics: [],
    industries: ["fintech"],
    hires_for: [],
    reasons: [],
    hires_in: { remote: true, countries: ["United States"] },
    ...patch,
  };
};

const answer = (patch: Partial<CompanySuggestions> = {}): CompanySuggestions => ({
  hiringNow: [co("Nebius"), co("Headway"), co("Kit")],
  worthWatching: [],
  notScannable: [],
  scanned: 24687,
  pastEmployers: [],
  lookalikes: [],
  packs: [],
  coverage: { in_industries: 0, trackable: 0 },
  index_generated_at: "2026-10-07T09:55:42.522Z",
  ...patch,
});

function Panel({ state, industries = 3, companies = 0, poolSize }: { state: SuggestState; industries?: number; companies?: number; poolSize?: number | null }) {
  const watched = new Set(Array.from({ length: companies }, (_, i) => `lever:c${i}`));
  return (
    <ForYou
      state={state}
      watched={watched}
      muted={new Set()}
      pastEmployers={[]}
      onPastEmployers={() => {}}
      onAddMany={() => []}
      onRemoveMany={() => {}}
      onMute={() => {}}
      onUnmute={() => {}}
      industries={industries}
      poolSize={poolSize}
    />
  );
}

const skeleton = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-lens]");

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the lens a loading page draws", () => {
  it("is the one it will open on: Starter packs with industries or at 0 companies, else Hiring for you now", () => {
    expect(openingLens(13, 99)).toBe("packs");
    expect(openingLens(0, 0)).toBe("packs");
    expect(openingLens(0, 5)).toBe("hiring");
    expect(openingLens(undefined, 5)).toBe("hiring");
  });

  it("draws Starter packs as pack cards with chip shapes, and the status in the header's place", () => {
    const { container } = render(<Panel state={{ kind: "loading" }} industries={13} companies={99} poolSize={24687} />);
    expect(skeleton(container)?.dataset.lens).toBe("packs");
    expect(container.querySelectorAll("[data-skeleton=pack]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-skeleton=card]")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("Matching 24,687 companies to your profile");
  });

  it("draws Hiring for you now as suggestion cards", () => {
    const { container } = render(<Panel state={{ kind: "loading" }} industries={0} companies={4} />);
    expect(skeleton(container)?.dataset.lens).toBe("hiring");
    expect(container.querySelectorAll("[data-skeleton=card]")).toHaveLength(6);
  });

  it("leaves the number out while it isn't known, rather than guess", () => {
    render(<Panel state={{ kind: "loading" }} />);
    expect(screen.getByRole("status").textContent).toBe("Matching companies to your profile");
  });

  it("asks for industries straight away in Starter packs when there are none", () => {
    render(<Panel state={{ kind: "loading" }} industries={0} companies={0} />);
    expect(screen.getByText("Starter packs need industries")).toBeTruthy();
  });

  it("shapes a card skeleton like the card that replaces it", () => {
    const { container } = render(
      <>
        <Panel state={{ kind: "loading" }} industries={0} companies={4} />
        <SuggestionCard s={co("Nebius")} added={false} onAdd={() => {}} onRemove={() => {}} onHide={() => {}} />
      </>,
    );
    const box = (el: Element | null) =>
      (el?.className ?? "")
        .split(/\s+/)
        .filter((c) => /^(flex|flex-col|gap-3|rounded-md|border|bg-raised|p-4|min-w-0)$/.test(c))
        .sort();
    expect(box(container.querySelector("[data-skeleton=card]"))).toEqual(box(container.querySelector("article")));
    // Two lines next to the monogram (name, where they hire), then the Add and Hide row.
    expect(container.querySelector("[data-skeleton=card]")?.querySelectorAll("p")).toHaveLength(2);
  });
});

describe("after 10 seconds", () => {
  it("says how long the last match took here", () => {
    localStorage.setItem(MATCH_MS_KEY, "17600");
    vi.useFakeTimers();
    render(<Panel state={{ kind: "loading" }} poolSize={24687} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status").textContent).toBe("Still matching. Last time it took about 20 seconds.");
    act(() => void vi.advanceTimersByTime(15_000));
    expect(screen.getByRole("status").textContent).toBe("Still matching. This is taking longer than last time (about 20 seconds).");
  });

  it("gives no number before a match was ever timed", () => {
    vi.useFakeTimers();
    render(<Panel state={{ kind: "loading" }} />);
    act(() => void vi.advanceTimersByTime(9_999));
    expect(screen.getByRole("status").textContent).toBe("Matching companies to your profile");
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toBe("Still matching. The first match after RawJobs starts takes the longest.");
  });

  it("rounds the estimate up to 5 seconds", () => {
    expect(matchEstimate()).toBeNull();
    localStorage.setItem(MATCH_MS_KEY, "12000");
    expect(matchEstimate()).toBe(15);
    localStorage.setItem(MATCH_MS_KEY, "20000");
    expect(matchEstimate()).toBe(20);
  });
});

describe("reloading with the previous answer", () => {
  it("keeps it readable at full strength, with Updating suggestions after the tabs", () => {
    const { container } = render(<Panel state={{ kind: "loading", previous: answer() }} industries={0} companies={4} />);
    expect(screen.getByText("Nebius")).toBeTruthy();
    expect(container.querySelector(".opacity-60")).toBeNull();
    expect(skeleton(container)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Updating suggestions");
    expect(container.querySelector("[aria-busy=true]")).toBeTruthy();
  });

  it("says nothing once the new answer is in", () => {
    render(<Panel state={{ kind: "ready", data: answer() }} industries={0} companies={4} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("reduced motion", () => {
  it("only spins where motion is welcome, and fades the bars in with opacity alone", () => {
    const { container: loading } = render(<Panel state={{ kind: "loading" }} />);
    const { container: reloading } = render(<Panel state={{ kind: "loading", previous: answer() }} industries={0} companies={4} />);
    for (const c of [loading, reloading]) {
      const spinners = [...c.querySelectorAll("svg.lucide-loader-circle")];
      expect(spinners.length).toBeGreaterThan(0);
      for (const s of spinners) expect(s.getAttribute("class")).toMatch(/(^|\s)motion-safe:animate-spin(\s|$)/);
      expect(c.innerHTML).not.toMatch(/(^|[\s"])animate-spin/);
    }
    expect(skeleton(loading)?.className).toMatch(/animate-\[rj-fade_/);
  });

  it("stops the shimmer (static bars) in the kit's reduced-motion rules", () => {
    const css = readFileSync(resolvePath("design/components/bundle.css"), "utf8");
    const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toMatch(/\.rj-skel::after \{ animation: none; \}/);
  });
});

describe("the shimmer token", () => {
  it("is a different colour from the bar in every theme, so the shimmer shows", () => {
    type Token = { name: string; value: string | Record<string, string> };
    const t = JSON.parse(readFileSync(resolvePath("apps/web/src/design/tokens.json"), "utf8")) as { color: { themes: { id: string }[]; tokens: Token[] } };
    const byName = new Map(t.color.tokens.map((x) => [x.name, x.value]));
    const resolve = (name: string, theme: string): string => {
      const v = byName.get(name);
      const raw = typeof v === "string" ? v : v?.[theme];
      const ref = raw?.match(/^\{([a-z0-9-]+)\}$/)?.[1];
      return ref ? resolve(ref, theme) : (raw ?? name);
    };
    for (const { id } of t.color.themes) expect(resolve("skeleton-shine", id), id).not.toBe(resolve("skeleton-bg", id));
  });
});

describe("useCompanySuggestions", () => {
  const draft: Draft = { ...emptyDraft(), include: ["product manager"] };

  it("asks at once on the first visit, then waits a moment after a profile edit", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify(answer())));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ d }) => useCompanySuggestions(d), { initialProps: { d: draft } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.kind).toBe("ready");
    rerender({ d: { ...draft, include: ["product lead"] } });
    expect(result.current).toMatchObject({ kind: "loading", previous: { scanned: 24687 } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(599)));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("times a match that was worked out, not a kept answer", async () => {
    vi.useFakeTimers();
    let delay = 17_600;
    vi.stubGlobal("fetch", async () => {
      await new Promise((r) => setTimeout(r, delay));
      return new Response(JSON.stringify(answer()));
    });
    const { rerender } = renderHook(({ d }) => useCompanySuggestions(d), { initialProps: { d: draft } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(17_600)));
    expect(localStorage.getItem(MATCH_MS_KEY)).toBe("17600");
    delay = 20;
    rerender({ d: { ...draft, include: ["product lead"] } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(700)));
    expect(localStorage.getItem(MATCH_MS_KEY)).toBe("17600");
  });
});
