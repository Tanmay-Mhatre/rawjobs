// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DirectoryQuery, SLOW_MS, useDirectorySearch } from "../src/lib/directorySearch";

afterEach(() => vi.unstubAllGlobals());

/** The local server's search: answers each request after `delay(body)` ms with the page it was asked for. */
function server(delay: (body: { q: string; page: number }) => number) {
  const asked: { q: string; page: number }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      asked.push(body);
      const answer = { rows: [], total: 100, exact: 0, page: body.page, pageSize: 25, searchReady: true };
      return new Promise<Response>((done, fail) => {
        const t = setTimeout(() => done(new Response(JSON.stringify(answer))), delay(body));
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          fail(new DOMException("aborted", "AbortError"));
        });
      });
    }),
  );
  return asked;
}

const query = (o: Partial<DirectoryQuery> = {}): DirectoryQuery => ({ q: "", industry: "", system: "all", page: 1, ...o });
const answered = (s: { answer: unknown }) => (s.answer as { page?: number } | null)?.page;

describe("useDirectorySearch", () => {
  it("keeps the last page while a quick next one loads (no placeholders), and goes slow after SLOW_MS", async () => {
    server((b) => (b.page === 3 ? SLOW_MS + 300 : 20));
    const { result, rerender } = renderHook((q: DirectoryQuery) => useDirectorySearch(q, { watched: new Set() }), { initialProps: query() });
    await waitFor(() => expect(answered(result.current)).toBe(1));

    rerender(query({ page: 2 }));
    expect(result.current.loading).toBe(true);
    expect(result.current.slow).toBe(false);
    expect(answered(result.current)).toBe(1);
    await waitFor(() => expect(answered(result.current)).toBe(2));
    expect(result.current.slow).toBe(false);

    rerender(query({ page: 3 }));
    await waitFor(() => expect(result.current.slow).toBe(true), { timeout: SLOW_MS + 200 });
    await waitFor(() => expect(answered(result.current)).toBe(3), { timeout: 1000 });
    expect(result.current.slow).toBe(false);
  });

  it("waits for typing to pause, and never lets an older answer replace a newer one", async () => {
    const asked = server((b) => (b.q === "re" ? 200 : 10));
    const { result, rerender } = renderHook((q: DirectoryQuery) => useDirectorySearch(q, { watched: new Set() }), { initialProps: query() });
    await waitFor(() => expect(answered(result.current)).toBe(1));
    rerender(query({ q: "r" }));
    rerender(query({ q: "re" }));
    rerender(query({ q: "rev" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only the first load and the last search went out.
    expect(asked.map((b) => b.q)).toEqual(["", "rev"]);
  });

  it("doesn't ask again when only your companies change (adding one doesn't reshuffle the list)", async () => {
    const asked = server(() => 5);
    const { result, rerender } = renderHook((w: Set<string>) => useDirectorySearch(query(), { watched: w }), { initialProps: new Set<string>() });
    await waitFor(() => expect(result.current.answer).not.toBeNull());
    rerender(new Set(["lever:acme"]));
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toHaveLength(1);
  });
});
