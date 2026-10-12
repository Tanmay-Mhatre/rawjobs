import { describe, expect, it } from "vitest";
import { htmlToText, inferWorkplace, isPlaceholderBoard, matchesAny, matchesTerm, safeUrl } from "../src/text";

describe("isPlaceholderBoard", () => {
  it("catches vendor sandboxes, training and test tenants", () => {
    for (const name of [
      "Lever Implementation Training Environment",
      "Rhaegal - Arago Sandbox",
      "Acme (Sandbox)",
      "Acme Sandbox",
      "Acme Sandbox 2",
      "Greenhouse Test Sandbox",
      "Sandbox Account - Acme",
      "Acme Test Company",
      "Demo Company",
      "Acme Staging",
      "DO NOT USE - Acme",
    ])
      expect(isPlaceholderBoard(name), name).toBe(true);
  });

  it("keeps real companies whose name merely contains one of those words", () => {
    for (const name of ["Sandbox VR", "The Sandbox", "Sandbox AQ", "SandboxAQ", "Testlio", "Demoflow", "Training Peaks", "Stripe", "", undefined, null])
      expect(isPlaceholderBoard(name), String(name)).toBe(false);
  });
});

describe("matchesTerm", () => {
  it("matches whole words only", () => {
    expect(matchesTerm("Senior AI Product Manager", "ai")).toBe(true);
    expect(matchesTerm("AI-native payments", "ai")).toBe(true);
    expect(matchesTerm("Maintain our detail-oriented culture", "ai")).toBe(false);
    expect(matchesTerm("Product Managers", "product manager")).toBe(false);
  });

  it("is case-insensitive and treats spaces and hyphens alike", () => {
    expect(matchesTerm("SENIOR PRODUCT-MANAGER", "product manager")).toBe(true);
    expect(matchesTerm("Remote-MENA", "remote - mena")).toBe(true);
    expect(matchesTerm("Remote MENA", "remote-mena")).toBe(true);
  });

  it("escapes regex characters in terms", () => {
    expect(matchesTerm("Experience with C++ required", "c++")).toBe(true);
    expect(matchesTerm("Abu Dhabi (UAE)", "uae")).toBe(true);
  });

  it("does not treat accented letters as word boundaries", () => {
    expect(matchesTerm("Zürich", "rich")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("decodes double-escaped Greenhouse HTML", () => {
    const html = "&lt;h2&gt;Role&lt;/h2&gt;&lt;p&gt;Payments &amp;amp; KYC&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;";
    expect(htmlToText(html)).toBe("Role\nPayments & KYC\n\n• One");
  });

  it("handles normal HTML, numeric entities and empty input", () => {
    expect(htmlToText("<p>It&#39;s&nbsp;<b>great</b></p><script>x()</script>")).toBe("It's great");
    expect(htmlToText(null)).toBe("");
  });

  it("keeps literal &lt; in prose that is already real HTML", () => {
    expect(htmlToText("<p>Use 1 &lt; 2</p>")).toBe("Use 1 < 2");
  });
});

describe("inferWorkplace", () => {
  it("reads remote and hybrid from free text", () => {
    expect(inferWorkplace("Dubai or Remote")).toBe("remote");
    expect(inferWorkplace("London (Hybrid)")).toBe("hybrid");
    expect(inferWorkplace("Dubai")).toBe("unknown");
  });
});

describe("matchesAny", () => {
  it("agrees with checking each term on its own", () => {
    const terms = ["ai", "product manager", "c++", "uae", "abu dhabi"];
    const texts = ["AI-native", "maintain", "Senior Product-Manager", "C++ engineer", "Dubai, UAE", "Abu  Dhabi", "nothing here"];
    for (const t of texts) expect(matchesAny(t, terms)).toBe(terms.some((x) => matchesTerm(t, x)));
    expect(matchesAny("anything", [])).toBe(false);
  });
});

describe("safeUrl", () => {
  it("keeps http(s) links and drops everything else", () => {
    expect(safeUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>", "vbscript:x", "/relative", "", null, undefined]) expect(safeUrl(bad)).toBeUndefined();
  });
});
