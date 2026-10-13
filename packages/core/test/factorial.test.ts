import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const page = readFileSync(new URL("./fixtures/pages/factorial-careers.html", import.meta.url), "utf8");

describe("factorial", () => {
  it("reads every job off the careers root (a saved real page) under its office, descriptions from div.styledText", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes("/job_posting/") ? text("<h1>x</h1><div class='styledText'><p>Build <b>firmware</b>.</p><div>Milano</div></div><div>Apply</div>") : text(page),
    );
    const c = getConnector("factorial")!;
    const r = { name: "3Bee", enabled: true, ats: "factorial", slug: "3bee.factorial.it" } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://3bee.factorial.it/"]);
    expect(jobs.map((j) => [j.title, j.location, j.url])).toEqual([
      ["Firmware & Hardware Developer", "Milano", "https://3bee.factorial.it/job_posting/firmware-hardware-developer-316683"],
      ["Biodiversity Strategist", "Milano", "https://3bee.factorial.it/job_posting/biodiversity-strategist-311277"],
    ]);
    expect(jobs[0]!.id).toBe("factorial:3bee.factorial.it:316683");
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Build firmware.\nMilano");
  });

  it("only reads Factorial hosts", async () => {
    const { http } = fakeHttp(() => text(page));
    await expect(getConnector("factorial")!.fetch({ name: "x", enabled: true, ats: "factorial", slug: "careers.example.com" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(
      /not a Factorial/,
    );
  });

  it("is recognised on its country domains", () => {
    expect(detectCompany("https://3bee.factorial.it/job_posting/x-1")).toMatchObject({ ats: "factorial", slug: "3bee.factorial.it", supported: true });
    expect(detectCompany("https://highbras.factorialhr.com.br/")).toMatchObject({ slug: "highbras.factorialhr.com.br" });
    expect(detectCompany("https://factorialhr.com/")).toBeNull();
  });
});
