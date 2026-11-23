// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { telegramStatus } from "../src/lib/automation";
import { fetchWithin } from "../src/lib/net";
import { useSetupStatus } from "../src/lib/setup";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a part of the page that throws", () => {
  it("shows an error card with a way back, not a blank window", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const Widget = () => {
      if (broken) throw new Error("bad data");
      return <p>working again</p>;
    };
    render(
      <ErrorBoundary where="this page">
        <Widget />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong on this page/);
    broken = false;
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByText("working again")).toBeTruthy();
  });
});

describe("requests to the local server", () => {
  it("give up after their time limit instead of waiting forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    await expect(fetchWithin("/api/x", {}, 20)).rejects.toThrow(/Timed out after 0 s/);
  });

  it("a panel's status call that gets no answer returns an error (its card shows Try again), not a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await telegramStatus()).toMatchObject({ ok: false, error: "Failed to fetch" });
  });

  it("a setup check that fails says so, rather than passing for the hosted copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { result } = renderHook(() => useSetupStatus());
    await act(async () => {});
    expect(result.current.failed).toBe(true);
    expect(result.current.status).toBeUndefined();
  });
});
