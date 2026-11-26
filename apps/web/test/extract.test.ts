// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToMarkdown } from "../src/lib/extract";

describe("htmlToMarkdown (Word résumés)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps nested lists, indented", () => {
    const md = htmlToMarkdown("<ul><li>Led product<ul><li>Grew revenue<ul><li>By 40%</li></ul></li></ul></li><li>Hired a team</li></ul>");
    expect(md).toContain("- Led product\n  - Grew revenue\n    - By 40%");
    expect(md).toContain("- Hired a team");
  });

  it("never parses a nested list into the page", () => {
    const setter = vi.spyOn(Element.prototype, "innerHTML", "set");
    const md = htmlToMarkdown('<ul><li>a<ul><li><img src="x" onerror="globalThis.__hit=1">b</li></ul></li></ul>');
    expect(md).toContain("  - b");
    expect(setter).not.toHaveBeenCalled();
    expect((globalThis as { __hit?: number }).__hit).toBeUndefined();
  });
});
