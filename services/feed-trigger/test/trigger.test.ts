import { describe, expect, it } from "vitest";
import { dispatch } from "../src/index";

const env = { GITHUB_TOKEN: "t", REPO: "o/r", WORKFLOW: "jobs-daily.yml", REF: "main" };

describe("the feed trigger", () => {
  it("starts the workflow on main", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await dispatch(env, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/actions/workflows/jobs-daily.yml/dispatches");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ref: "main" });
  });

  it("fails loudly when GitHub refuses", async () => {
    await expect(dispatch(env, (async () => new Response("Bad credentials", { status: 401 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 401/);
  });
});
