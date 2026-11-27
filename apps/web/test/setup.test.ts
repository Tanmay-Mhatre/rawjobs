import { afterEach, describe, expect, it, vi } from "vitest";
import { causeOf, draftFromConfig, draftToConfig, emptyDraft, rebaseDraft, saveConfig, setupProgress, STEP, stepBlocker, type Draft } from "../src/lib/setup";

const base: Draft = { ...emptyDraft(), include: ["product manager"], places: ["dubai"] };
const row = (slug: string) => ({ id: slug, input: `https://jobs.lever.co/${slug}`, state: "saved" as const, name: slug, ats: "lever" as const, slug });

describe("rebaseDraft", () => {
  it("takes the newly saved value for fields the user hasn't touched", () => {
    const next = { ...base, companies: [row("kraken")] };
    expect(rebaseDraft(base, base, next).companies).toEqual([row("kraken")]);
  });

  it("keeps unsaved edits to other fields (a Settings edit survives a Companies auto-save)", () => {
    const draft = { ...base, places: ["dubai", "london"], companies: [row("kraken")] };
    const next = { ...base, companies: [row("kraken")] };
    const out = rebaseDraft(draft, base, next);
    expect(out.places).toEqual(["dubai", "london"]);
    expect(out.companies).toEqual([row("kraken")]);
  });

  it("leaves nothing dirty once the auto-saved fields match what was saved", () => {
    const draft = { ...base, companies: [row("kraken")], muted: ["lever:bybit"] };
    const next = { ...base, companies: [row("kraken")], muted: ["lever:bybit"] };
    expect(JSON.stringify(rebaseDraft(draft, base, next))).toBe(JSON.stringify(next));
  });
});

describe("clearing a Locations section", () => {
  it("clearing Work style or the only places blocks the step until something is picked again", () => {
    expect(stepBlocker(STEP.locations, { ...base, office: [], remote: false })).toBe("Pick at least one work style.");
    expect(stepBlocker(STEP.locations, { ...base, office: ["onsite"], places: [] })).toBe("Add a place you can work from.");
  });
});

describe("work style", () => {
  it("round-trips through the config: both kinds save as any, one kind is kept, remote only drops places", () => {
    expect(draftToConfig(base).profile.locations.workplace).toEqual([]);
    const hybrid = { ...base, office: ["hybrid"] as Draft["office"] };
    expect(draftFromConfig(draftToConfig(hybrid)).office).toEqual(["hybrid"]);
    const remoteOnly = { ...base, office: [] as Draft["office"], remote: true, remoteOk: ["emea"] };
    const cfg = draftToConfig(remoteOnly);
    expect(cfg.profile.locations.include).toEqual([]);
    expect(draftFromConfig(cfg).office).toEqual([]);
  });

  it("Locations needs a work style, and a place or remote region for it", () => {
    expect(stepBlocker(STEP.locations, base)).toBeNull();
    expect(stepBlocker(STEP.locations, { ...base, office: [] })).toBe("Pick at least one work style.");
    expect(stepBlocker(STEP.locations, { ...base, places: [] })).toBe("Add a place you can work from.");
    expect(stepBlocker(STEP.locations, { ...base, office: [], remote: true })).toBe("Pick where you can work remotely.");
  });
});

describe("setupProgress", () => {
  const ready: Draft = { ...base, office: ["onsite"], furthestStep: STEP.locations };

  it("asks about industries, not topics, after roles and places", () => {
    expect(setupProgress({ ...ready, keywords: { payments: 3 } }).nextStep).toBe(STEP.industries);
    expect(setupProgress({ ...ready, industries: ["fintech"] }).nextStep).toBe(STEP.review);
  });
});

describe("hosted mode (no local server)", () => {
  it("checkCompanies still detects a Greenhouse URL, loading detection on demand", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/data", async (orig) => ({ ...(await orig<typeof import("../src/lib/data")>()), canRunLocally: false }));
    try {
      const { checkCompanies } = await import("../src/lib/setup");
      const [row] = await checkCompanies(["https://job-boards.greenhouse.io/stripe"]);
      expect(row).toMatchObject({ ats: "greenhouse", slug: "stripe", key: "greenhouse:stripe", careers_url: "https://job-boards.greenhouse.io/stripe", status: "live" });
    } finally {
      vi.doUnmock("../src/lib/data");
      vi.resetModules();
    }
  });

  it("draftFromConfig marks saved companies on unsupported systems as coming soon", () => {
    const d = draftFromConfig({
      companies: [
        { ats: "greenhouse", slug: "stripe" },
        { ats: "nosuchats", slug: "x" },
      ],
    });
    expect(d.companies.map((c) => c.state)).toEqual(["saved", "soon"]);
  });
});

describe("saveConfig", () => {
  const config = draftToConfig(base);
  const answer = (impl: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));
  afterEach(() => vi.unstubAllGlobals());

  it("returns cause offline on network error, never throwing", async () => {
    answer(async () => {
      throw new TypeError("Failed to fetch");
    });
    const res = await saveConfig(config);
    expect(res).toMatchObject({ ok: false, cause: "offline", errors: "Failed to fetch" });
  });

  it("returns cause server on a non-JSON 500", async () => {
    answer(async () => new Response("<html>Internal error</html>", { status: 500 }));
    expect(await saveConfig(config)).toMatchObject({ ok: false, cause: "server", errors: "HTTP 500" });
  });

  it("passes the server's own refusal through, which counts as invalid", async () => {
    answer(async () => new Response(JSON.stringify({ ok: false, errors: "titles: required", issues: [{ path: "titles", message: "required" }] })));
    const res = await saveConfig(config);
    expect(res).toEqual({ ok: false, errors: "titles: required", issues: [{ path: "titles", message: "required" }] });
    if (!res.ok) expect(causeOf(res)).toBe("invalid");
  });
});
