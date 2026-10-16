// @vitest-environment happy-dom
import type { FitCheck } from "@rawjobs/core/schema";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "../src/components/JobDetail";
import { Toaster } from "../src/components/Toast";
import type { Job, Profile } from "../src/lib/data";
import { fitFixes, fixApplied, ProfileFixProvider, type ProfileFixApi } from "../src/lib/profileFix";
import { emptyDraft } from "../src/lib/setup";
import { makeJob } from "./helpers";

afterEach(cleanup);

const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: ["senior"],
  locations: { include: ["Germany"], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: {},
  min_score: 65,
} as unknown as Profile;

const withChecks = (checks: FitCheck[], over: Partial<Job> = {}) =>
  makeJob({ countries: ["Germany"], why: { title: 25, level: 0, location: 20, keywords: [], keywordPoints: 0, industry: 10, checks }, ...over });
const visaUnknown: FitCheck = { id: "visa", status: "unknown", note: "Doesn't say if it sponsors visas" };
const payUnknown: FitCheck = { id: "pay", status: "unknown", note: "Pay not listed" };
const levelMissed: FitCheck = { id: "level", status: "missed", note: "Principal, Staff & Lead: not your level" };

describe("fitFixes", () => {
  it("offers to add the job's one country to where you can work, when visa is unknown or missed", () => {
    expect(fitFixes(withChecks([visaUnknown]))).toEqual([expect.objectContaining({ check: "visa", label: "I can work in Germany", field: "workAuthorization", value: "germany" })]);
    expect(fitFixes(withChecks([{ ...visaUnknown, status: "missed" }]))).toHaveLength(1);
    expect(fitFixes(withChecks([{ ...visaUnknown, status: "met" }]))).toEqual([]);
  });

  it("offers no visa fix when the job is in several countries or none", () => {
    expect(fitFixes(withChecks([visaUnknown], { countries: ["Germany", "France"] }))).toEqual([]);
    expect(fitFixes(withChecks([visaUnknown], { countries: [] }))).toEqual([]);
  });

  it("links to the pay floor when pay is unknown or below it", () => {
    expect(fitFixes(withChecks([payUnknown]))).toEqual([{ check: "pay", label: "Change pay floor", section: "dealbreakers" }]);
    expect(fitFixes(withChecks([{ ...payUnknown, status: "missed" }]))).toHaveLength(1);
  });

  it("offers the title's own level word when the level is missed, and nothing for a mid-level title", () => {
    expect(fitFixes(withChecks([levelMissed], { title: "Lead Product Manager" }))).toEqual([expect.objectContaining({ check: "level", label: "Count Lead roles", field: "seniority", value: "lead" })]);
    expect(fitFixes(withChecks([levelMissed], { title: "Product Manager" }))).toEqual([]);
    expect(fitFixes(withChecks([{ ...levelMissed, status: "near" }], { title: "Lead Product Manager" }))).toEqual([]);
  });

  it("hides a fix your saved profile already has", () => {
    const [fix] = fitFixes(withChecks([visaUnknown]));
    expect(fixApplied(fix!, { ...emptyDraft(), workAuthorization: ["Germany"] })).toBe(true);
    expect(fixApplied(fix!, emptyDraft())).toBe(false);
  });
});

describe("Why it matched fixes", () => {
  const job = withChecks([levelMissed, payUnknown, visaUnknown], { title: "Lead Product Manager" });
  const renderWith = (api: ProfileFixApi | null) =>
    render(
      <ProfileFixProvider value={api}>
        <JobDetail job={job} profile={profile} onUpdate={() => {}} />
        <Toaster />
      </ProfileFixProvider>,
    );

  it("shows the fixes in the folded pills and saves one word, saying the next scan re-scores", async () => {
    const add = vi.fn(async () => null);
    renderWith({ draft: emptyDraft(), add });
    expect(screen.getByRole("link", { name: "Change pay floor" }).getAttribute("href")).toBe("#settings/profile?section=dealbreakers");
    expect(screen.getByRole("button", { name: "Count Lead roles" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I can work in Germany" }));
    });
    expect(add).toHaveBeenCalledWith("workAuthorization", "germany");
    expect(document.body.textContent).toContain("Added Germany to where you can work. Scores update on the next scan.");
  });

  it("shows the server's error when the save fails", async () => {
    renderWith({ draft: emptyDraft(), add: async () => "Couldn't save" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Count Lead roles" }));
    });
    expect(document.body.textContent).toContain("Couldn't save");
  });

  it("offers no fixes when your profile can't be saved from here (the demo)", () => {
    renderWith(null);
    expect(screen.queryByRole("button", { name: /I can work in|Count .* roles/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Change pay floor" })).toBeNull();
  });

  it("drops a fix once your saved profile has it", () => {
    renderWith({ draft: { ...emptyDraft(), seniority: ["lead"] }, add: async () => null });
    expect(screen.queryByRole("button", { name: "Count Lead roles" })).toBeNull();
    expect(screen.getByRole("button", { name: "I can work in Germany" })).toBeTruthy();
  });
});
