// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotForMeProvider, useNotForMeApi } from "../src/components/NotForMe";
import { RadarPage } from "../src/components/radar/RadarPage";
import { Toaster } from "../src/components/Toast";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { applyFilters, DEFAULT_FILTERS, type Ctx } from "../src/lib/filters";
import { hiddenByRules, offerFor, ruleHides, type HideRule } from "../src/lib/notForMe";
import { addRule, usePrefs, withDefaults } from "../src/lib/prefs";
import { useUserState, type UserState } from "../src/lib/userState";
import { makeJob } from "./helpers";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

let n = 0;
const job = (o: Partial<Job> = {}): Job => {
  n++;
  return makeJob({
    id: `greenhouse:acme:${n}`,
    why: { title: 30, location: 20, keywords: [], keywordPoints: 5, industry: 10 },
    group: `Acme|senior product manager|${n}`,
    ...o,
  });
};
const usd = (min: number, max?: number, period = "year") => ({ min, max, currency: "USD", period });

describe("reason to rule", () => {
  it("offers the job's own level for too senior and too junior", () => {
    expect(offerFor("too-senior", job({ seniority: "principal" }))).toEqual({ offer: { kind: "rule", rule: { kind: "seniority", level: "principal" } } });
    expect(offerFor("too-junior", job({ seniority: "entry" }))).toEqual({ offer: { kind: "rule", rule: { kind: "seniority", level: "entry" } } });
  });

  it("offers pay only when the job lists pay with a currency, at its top figure", () => {
    expect(offerFor("pay", job({ salary: usd(90_000, 120_000) }))).toEqual({ offer: { kind: "rule", rule: { kind: "pay", max: 120_000, currency: "USD", period: "year" } } });
    expect("note" in offerFor("pay", job())).toBe(true);
    expect("note" in offerFor("pay", job({ salary: { min: 100 } }))).toBe(true);
  });

  it("offers a place only when the job names one clear place", () => {
    expect(offerFor("location", job())).toEqual({ offer: { kind: "rule", rule: { kind: "place", place: "Dubai, United Arab Emirates" } } });
    expect(offerFor("location", job({ cities: [], countries: ["Germany"] }))).toEqual({ offer: { kind: "rule", rule: { kind: "place", place: "Germany" } } });
    expect("note" in offerFor("location", job({ cities: ["Dubai, United Arab Emirates", "London, United Kingdom"], countries: ["United Arab Emirates", "United Kingdom"] }))).toBe(true);
    expect("note" in offerFor("location", job({ workplace: "remote" }))).toBe(true);
  });

  it("only records field, skills and other", () => {
    for (const r of ["field", "skills", "other"] as const) expect(offerFor(r, job())).toEqual({ note: "Noted. This helps tune your matches later." });
    expect(offerFor("company", job())).toEqual({ offer: { kind: "company", company: "Acme" } });
  });
});

describe("rules filter the Radar", () => {
  const pay: HideRule = { kind: "pay", max: 120_000, currency: "USD", period: "year" };

  it("pay: hides lower pay in the same currency and period only; unknown never fails", () => {
    expect(ruleHides(pay, job({ salary: usd(80_000, 110_000) }))).toBe(true);
    expect(ruleHides(pay, job({ salary: usd(120_000) }))).toBe(true);
    expect(ruleHides(pay, job({ salary: usd(100_000, 150_000) }))).toBe(false);
    expect(ruleHides(pay, job())).toBe(false);
    expect(ruleHides(pay, job({ salary: { min: 50_000, currency: "EUR", period: "year" } }))).toBe(false);
    expect(ruleHides(pay, job({ salary: usd(50, 60, "hour") }))).toBe(false);
    expect(ruleHides(pay, job({ salary: { min: 50_000, period: "year" } }))).toBe(false);
  });

  it("seniority and place", () => {
    expect(ruleHides({ kind: "seniority", level: "senior" }, job())).toBe(true);
    expect(ruleHides({ kind: "seniority", level: "senior" }, job({ seniority: "mid" }))).toBe(false);
    const dubai: HideRule = { kind: "place", place: "Dubai, United Arab Emirates" };
    expect(ruleHides(dubai, job())).toBe(true);
    // Also in London: still a place you might take, so it stays.
    expect(ruleHides(dubai, job({ cities: ["Dubai, United Arab Emirates", "London, United Kingdom"], countries: ["United Arab Emirates", "United Kingdom"] }))).toBe(false);
    expect(ruleHides(dubai, job({ cities: [], countries: [] }))).toBe(false);
    expect(ruleHides({ kind: "place", place: "United Arab Emirates" }, job({ cities: ["Abu Dhabi, United Arab Emirates"] }))).toBe(true);
    // Place rules add up.
    const both = job({ cities: ["Dubai, United Arab Emirates", "London, United Kingdom"], countries: ["United Arab Emirates", "United Kingdom"] });
    expect(hiddenByRules(both, [dubai, { kind: "place", place: "United Kingdom" }])).toBe(true);
  });

  it("applyFilters hides by rule, keeps tracked jobs, and Include hidden shows them", () => {
    const senior = job({ id: "senior" });
    const mid = job({ id: "mid", seniority: "mid" });
    const saved = job({ id: "saved" });
    const noPay = job({ id: "nopay", seniority: "mid" });
    const eur = job({ id: "eur", seniority: "mid", salary: { min: 40_000, currency: "EUR", period: "year" } });
    const low = job({ id: "low", seniority: "mid", salary: usd(40_000, 50_000) });
    const user: UserState = { saved: { status: "saved", updatedAt: "", snapshot: { title: "", company: "", url: "", location: "", score: 0 } } };
    const ctx: Ctx = { user, min: 70, industriesOf: () => [], hiddenCompanies: new Set(), hideRules: [{ kind: "seniority", level: "senior" }, pay] };
    const ids = (show = false) => applyFilters([senior, mid, saved, noPay, eur, low], { ...DEFAULT_FILTERS, showHidden: show }, ctx).map((j) => j.id);
    expect(ids()).toEqual(["mid", "saved", "nopay", "eur"]);
    expect(ids(true)).toEqual(["senior", "mid", "saved", "nopay", "eur", "low"]);
  });
});

describe("prefs", () => {
  it("older exports without rules still load", () => {
    expect(withDefaults({ views: [], hiddenCompanies: ["Acme"] })).toEqual({ views: [], hiddenCompanies: ["Acme"], hideRules: [] });
  });
  it("a new pay rule in the same currency and period replaces the old one", () => {
    const a: HideRule = { kind: "pay", max: 100, currency: "USD", period: "year" };
    const b: HideRule = { kind: "pay", max: 120, currency: "USD", period: "year" };
    const c: HideRule = { kind: "pay", max: 90, currency: "EUR", period: "year" };
    expect(addRule(addRule([a, c], b), b)).toEqual([c, b]);
  });
});

/** The app's wiring in small: tracking, prefs, the API, the toast. */
function Harness({ jobs, onState }: { jobs: Job[]; onState: (s: { user: UserState; rules: HideRule[] }) => void }) {
  const user = useUserState();
  const prefs = usePrefs();
  const api = useNotForMeApi({ user: user.state, update: user.update, prefs: prefs.prefs, setRule: prefs.setRule, hideCompany: prefs.setCompanyHidden, jobs });
  onState({ user: user.state, rules: prefs.prefs.hideRules });
  const target = jobs[0]!;
  return (
    <NotForMeProvider value={api}>
      <button
        type="button"
        onClick={() => {
          const prev = user.state[target.id]?.status;
          user.toggleStatus(target, "dismissed");
          api.askWhy(target, prev);
        }}
      >
        Not interested
      </button>
      <Toaster />
    </NotForMeProvider>
  );
}

describe("Not interested, with a reason", () => {
  const setup = () => {
    const jobs = [job({ id: "a" }), job({ id: "b" }), job({ id: "c", seniority: "mid" })];
    const last: { user: UserState; rules: HideRule[] } = { user: {}, rules: [] };
    render(<Harness jobs={jobs} onState={(s) => Object.assign(last, s)} />);
    return { last, u: userEvent.setup() };
  };

  it("dismisses at once, the reason is optional and stored on the entry", async () => {
    const { last, u } = setup();
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    expect(last.user.a?.status).toBe("dismissed");
    expect(last.user.a?.reason).toBeUndefined();
    expect(screen.getByRole("status").textContent).toContain("Not interested: Senior Product Manager, Acme.");
    await u.click(screen.getByRole("button", { name: "Why?" }));
    await u.click(screen.getByRole("button", { name: "Not my field" }));
    expect(last.user.a?.reason).toBe("field");
    expect(screen.getByRole("status").textContent).toContain("Noted. This helps tune your matches later.");
    expect(last.rules).toEqual([]);
  });

  it("offers a rule, applies it on one tap, says what changed, and undoes it", async () => {
    const { last, u } = setup();
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    await u.click(screen.getByRole("button", { name: "Why?" }));
    await u.click(screen.getByRole("button", { name: "Too senior" }));
    expect(last.user.a?.reason).toBe("too-senior");
    expect(screen.getByRole("status").textContent).toContain("Hide all senior roles?");
    expect(last.rules).toEqual([]);
    await u.click(screen.getByRole("button", { name: "Hide senior roles" }));
    expect(last.rules).toEqual([{ kind: "seniority", level: "senior" }]);
    // "a" is already Not interested; "b" is the one more job it hides.
    expect(screen.getByRole("status").textContent).toContain("Hiding senior roles: 1 fewer job on your Radar.");
    const undo = screen.getAllByRole("button", { name: "Undo" }).at(-1)!;
    expect(document.activeElement).toBe(undo);
    await u.click(undo);
    expect(last.rules).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("Showing senior roles again.");
  });

  it("keeps the toast to one line until you ask why, then focuses the first reason", async () => {
    const { u } = setup();
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    expect(screen.queryByRole("button", { name: "Too senior" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Too senior" }));
  });

  it("Undo on the toast puts the job back", async () => {
    const { last, u } = setup();
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    await u.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
    expect(last.user.a).toBeUndefined();
  });

  it("drops the reason when the job moves to another status", async () => {
    const { last, u } = setup();
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    await u.click(screen.getByRole("button", { name: "Why?" }));
    await u.click(screen.getByRole("button", { name: "Other" }));
    expect(last.user.a?.reason).toBe("other");
    await u.click(screen.getByRole("button", { name: "Not interested" }));
    expect(last.user.a).toBeUndefined();
  });
});

describe("Radar keys", () => {
  it("X dismisses the selected job in one press", () => {
    const profile = {
      name: "Me",
      titles: { include: ["product manager"], exclude: [] },
      seniority_boost: [],
      locations: { include: ["Dubai"], remote_ok: [], remote_exclude: [], workplace: [] },
      industries: [],
      past_employers: [],
      keywords: {},
      min_score: 65,
    } as unknown as Profile;
    const meta = { version: 1, generatedAt: new Date().toISOString(), profile, companies: [], runs: [] } as DataMeta;
    const jobs = [job({ id: "a" }), job({ id: "b", company: "Beta" })];
    const onStatus = vi.fn();
    const noop = () => {};
    render(
      <RadarPage
        jobs={jobs}
        meta={meta}
        user={{}}
        prefs={{ views: [], hiddenCompanies: [], hideRules: [] }}
        onOpenOverlay={noop}
        overlayOpen={false}
        onStatus={onStatus}
        onUpdate={noop}
        onApply={noop}
        onSaveView={() => ({ id: "v", name: "", filters: DEFAULT_FILTERS, sort: "best" })}
        onRenameView={noop}
        onDeleteView={noop}
        onRestoreView={noop}
        onHideCompany={noop}
        onSetRule={noop}
        isYours={() => false}
        companyCount={0}
        onCompanies={noop}
        onEditProfile={noop}
      />,
    );
    act(() => void fireEvent.keyDown(window, { key: "j" }));
    act(() => void fireEvent.keyDown(window, { key: "x" }));
    expect(onStatus).toHaveBeenCalledOnce();
    expect(onStatus.mock.calls[0]![1]).toBe("dismissed");
  });
});
