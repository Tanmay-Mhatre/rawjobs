import { HostSkippedError, HttpError } from "@rawjobs/core";
import { describe, expect, it } from "vitest";
import { describeReasons, failReason, sameSwing } from "./jobs";

describe("failReason", () => {
  it("groups HTTP errors by status", () => {
    expect(failReason(new HttpError("HTTP 429 (https://a.dayforcehcm.com/x)", "https://a.dayforcehcm.com/x", 429))).toBe("HTTP 429");
  });

  it("groups timeouts whatever the wait", () => {
    expect(failReason(new HttpError("timed out after 30.002s (https://x.eightfold.ai/api)", "https://x.eightfold.ai/api"))).toBe("timeout");
  });

  it("drops URLs, names, hosts and numbers so boards with the same problem group together", () => {
    const a = failReason(new Error('Eightfold careers site "kroger.eightfold.ai" not found (no tenant domain on its page)'));
    const b = failReason(new Error('Eightfold careers site "zebra.eightfold.ai" not found (no tenant domain on its page)'));
    expect(a).toBe(b);
    expect(a).toBe('Eightfold careers site "…" not found (no tenant domain on its page)');
    expect(failReason(new HostSkippedError("skipped: x.example.com failed 5 times in a row (https://x.example.com/a)", "https://x.example.com/a"))).toBe("skipped: <host> failed N times in a row");
  });
});

describe("describeReasons", () => {
  it("lists the most common first and counts the rest", () => {
    expect(describeReasons({ timeout: 2, "HTTP 429": 600, "HTTP 404": 1, "HTTP 500": 3 }, 2)).toBe("HTTP 429 ×600, HTTP 500 ×3, 2 more");
    expect(describeReasons(undefined)).toBe("");
  });
});

describe("sameSwing", () => {
  it("ignores a growing directory: only the companies in both runs count", () => {
    // manatal on 14 Oct: 1113 -> 1673 companies, so 109829 -> 159486 jobs in all, but the same companies barely moved.
    expect(sameSwing({ before: 109829, after: 110200 })).toBeUndefined();
  });

  it("flags a big swing at the same companies", () => {
    expect(sameSwing({ before: 1000, after: 500 })).toBe("jobs at the same companies 1000 -> 500");
    expect(sameSwing({ before: 1000, after: 1300 })).toBe("jobs at the same companies 1000 -> 1300");
  });

  it("needs enough jobs to tell, and a count from the crawl", () => {
    expect(sameSwing({ before: 50, after: 0 })).toBeUndefined();
    expect(sameSwing(undefined)).toBeUndefined();
  });
});
