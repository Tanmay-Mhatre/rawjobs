// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "../src/components/JobDetail";
import type { Job, Profile } from "../src/lib/data";

afterEach(cleanup);

const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: [],
  locations: { include: ["Dubai"], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: { payments: 3 },
  min_score: 65,
} as Profile;

const job = (over: Partial<Job> = {}): Job => ({
  id: "greenhouse:acme:1",
  ats: "greenhouse",
  company: "Acme",
  title: "Senior Product Manager",
  location: "Dubai",
  workplace: "hybrid",
  url: "https://acme.example/jobs/1",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  firstSeen: new Date(Date.now() - 86_400_000).toISOString(),
  lastSeen: new Date().toISOString(),
  status: "open",
  score: 74,
  why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, freshness: 10 },
  countries: ["United Arab Emirates"],
  cities: ["Dubai, United Arab Emirates"],
  seniority: "senior",
  group: "Acme|senior product manager",
  hasDescription: false,
  ...over,
});

const renderDetail = (j: Job) => render(<JobDetail job={j} profile={profile} onUpdate={() => {}} isNew />);

describe("JobDetail", () => {
  it("shows the source tag with the hiring system and age in the head", () => {
    const { container } = renderDetail(job());
    const tag = container.querySelector(".rj-drawer__head .rj-source");
    expect(tag?.textContent).toContain("Greenhouse");
    expect(tag?.querySelector(".rj-source__age")?.textContent).toBe("2d");
    expect(tag?.querySelector(".rj-dot")).not.toBeNull();
  });

  it("never uses uppercase classes", () => {
    const { container } = renderDetail(job());
    expect(container.querySelector('[class*="uppercase"]')).toBeNull();
  });

  it("applies on the hiring system by name", () => {
    renderDetail(job());
    const apply = screen.getByRole("link", { name: "Apply on Greenhouse" });
    expect(apply.getAttribute("href")).toBe("https://acme.example/jobs/1");
    expect(apply.className).toContain("rj-btn--primary");
  });

  it("folds the notes field to a button until there's a note, then labels it visibly", () => {
    const { container } = renderDetail(job());
    expect(screen.queryByLabelText("Notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    const notes = screen.getByLabelText("Notes");
    expect(notes.tagName).toBe("TEXTAREA");
    expect(container.querySelector(`label[for="${notes.id}"]`)?.textContent).toBe("Notes");
  });

  it("shows a saved note straight away", () => {
    render(<JobDetail job={job()} entry={{ note: "Ask Sam for a referral", updatedAt: "", snapshot: { title: "", company: "", url: "", location: "", score: 0 } }} profile={profile} onUpdate={() => {}} />);
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Ask Sam for a referral");
  });

  it("hides Copy description when the job has no description, and shows it while one loads", () => {
    renderDetail(job());
    expect(screen.queryByRole("button", { name: /description/i })).toBeNull();
    cleanup();
    // descriptions.json never arrives, so the button stays in its loading state.
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    renderDetail(job({ hasDescription: true }));
    const copy = screen.getByRole("button", { name: "Copy description" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("puts the meta on one plain line", () => {
    const { container } = renderDetail(job());
    const meta = container.querySelector(".rj-drawer__meta");
    expect(meta?.textContent).toContain("Acme");
    expect(meta?.textContent).toContain("Hybrid");
    expect(meta?.querySelectorAll(".rj-sep").length).toBeGreaterThan(2);
  });
});

describe("Why it matched", () => {
  const scored = (over: Partial<Job> = {}) => job({ why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, industry: 10 }, ...over });
  // The checklist sits behind Details (remembered once opened).
  const why = () => {
    const section = screen.getByRole("heading", { name: "Why it matched" }).closest("section")!;
    const details = screen.queryByRole("button", { name: "Details" });
    if (details) fireEvent.click(details);
    return section.textContent!;
  };

  it("names the include term the scorer matched, even in a short or reordered title", () => {
    renderDetail(scored({ title: "Sr. PM, Payments" }));
    expect(why()).toContain("Title matches product manager");
    cleanup();
    renderDetail(scored({ title: "Manager, Product" }));
    expect(why()).toContain("Title matches product manager");
  });

  it("lists the dealbreakers a job breaks, folded or not", () => {
    const { container } = renderDetail(scored({ score: 32, why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, industry: 10, dealbreakers: ["Only for people already living in the United States"] } }));
    const note = container.querySelector("[data-dealbreakers]")!;
    expect(note.className).toContain("text-warning-text");
    expect(note.textContent).toContain("Breaks one of your dealbreakers");
    expect(note.querySelector("li")!.textContent).toBe("Only for people already living in the United States");
    cleanup();
    expect(renderDetail(scored()).container.querySelector("[data-dealbreakers]")).toBeNull();
  });

  it("says how close the level is", () => {
    const senior = { ...profile, seniority_boost: ["senior"] } as Profile;
    render(<JobDetail job={scored({ title: "Product Manager", why: { title: 25, location: 20, keywords: [], keywordPoints: 0, industry: 10 } })} profile={senior} onUpdate={() => {}} />);
    expect(why()).toContain("one level from yours");
  });

  it("doesn't claim an industry match it never checked", () => {
    renderDetail(scored());
    expect(why()).toContain("No industries picked, so every company counts");
    cleanup();
    const fintech = { ...profile, industries: ["payments"] } as Profile;
    render(<JobDetail job={scored()} profile={fintech} onUpdate={() => {}} yours />);
    expect(why()).toContain("One of your companies");
    cleanup();
    render(<JobDetail job={scored({ industries: ["payments"] })} profile={fintech} onUpdate={() => {}} />);
    expect(why()).toMatch(/In one of your industries: Payments/i);
  });

  it("lists your topics the posting doesn't mention, only when the posting was read", () => {
    const two = { ...profile, keywords: { payments: 3, kyc: 5 } } as Profile;
    render(<JobDetail job={scored({ hasDescription: true })} profile={two} onUpdate={() => {}} />);
    expect(why()).toContain("Not found: kyc.");
    cleanup();
    render(<JobDetail job={scored({ hasDescription: false, estimated: true, why: { title: 30, location: 20, keywords: [], keywordPoints: 0, industry: 10 } })} profile={two} onUpdate={() => {}} />);
    expect(why()).not.toContain("Not found");
    expect(why()).toContain("Topics not checked yet");
  });

  it("keeps topics your industries added apart from yours", () => {
    renderDetail(scored({ why: { title: 30, location: 20, keywords: ["payments", "kyc"], keywordPoints: 20, industry: 10 } }));
    expect(why()).toContain("Mentions your topics: payments; also kyc from your industries");
  });
});
