import { describe, expect, it } from "vitest";
import { releaseBase } from "../src/update";

describe("finding the newest Beta release", () => {
  it("asks GitHub with a time limit, so a stalled answer can't hold the update check", async () => {
    let signal: AbortSignal | undefined;
    const get = (async (_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(JSON.stringify([{ tag_name: "v1.2.3", draft: false }]));
    }) as unknown as typeof fetch;
    expect(await releaseBase("beta", get)).toMatch(/download\/v1\.2\.3$/);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("says GitHub is limiting requests on a 403 or 429, to try later", async () => {
    for (const status of [403, 429]) {
      const get = (async () => new Response("", { status })) as unknown as typeof fetch;
      await expect(releaseBase("beta", get)).rejects.toThrow(/limiting requests/);
    }
  });
});
