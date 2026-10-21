import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { brotli, brotliAsync } from "./feed-v2";

describe("brotliAsync", () => {
  it("makes the same bytes as brotli(), also several at once", async () => {
    // Feed-like text (repeats compress) with some noise.
    const rows = Array.from({ length: 20_000 }, (_, i) => `lever:acme-${i % 997}\t${i}\tSenior Engineer ${i % 13}\tLondon, UK\tonsite\t${randomBytes(4).toString("hex")}\n`);
    const samples = [rows.join(""), JSON.stringify({ jobs: rows.slice(0, 5000) }), "", "x"];
    const parallel = await Promise.all(samples.map((s) => brotliAsync(s)));
    samples.forEach((s, i) => expect(parallel[i]!.equals(brotli(s))).toBe(true));
  });
});
