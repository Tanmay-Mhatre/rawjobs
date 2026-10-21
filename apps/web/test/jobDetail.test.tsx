// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "../src/components/JobDetail";
import type { Job, Profile } from "../src/lib/data";
import { makeJob } from "./helpers";

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

const job = (over: Partial<Job> = {}): Job =>
  makeJob({
    id: "greenhouse:acme:1",
    workplace: "hybrid",
    postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    score: 74,
    why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, freshness: 10 },
    group: "Acme|senior product manager",
    ...over,
  });

const renderDetail = (j: Job) => render(<JobDetail job={j} profile={profile} onUpdate={() => {}} isNew />);
/** Both lines under the title: what the job is, then how fresh it is. */
const metaText = (c: HTMLElement) => [...c.querySelectorAll(".rj-drawer__meta")].map((m) => m.textContent).join(" | ");

describe("JobDetail", () => {
  it("names the company above the title, with the new dot, and says how old the posting is", () => {
    const { container } = renderDetail(job());
    const top = container.querySelector(".rj-drawer__top")!;
    expect(top.textContent).toContain("Acme");
    expect(top.querySelector(".rj-dot")).not.toBeNull();
    expect(container.querySelector(".rj-drawer__head .rj-source")).toBeNull();
    expect(metaText(container)).toMatch(/Posted 2d ago/);
  });

  it("shows the facts it knows as pills, and folds the unknown ones into one line", () => {
    const { container } = renderDetail(job({ employmentType: "full-time", department: "Product" }));
    const facts = [...container.querySelectorAll('[aria-label="Key facts"] li')].map((li) => li.textContent);
    expect(facts).toEqual(["Senior", "Full-time", "Product"]);
    expect(container.textContent).toContain("Not stated: salary.");
    // Said once: no Details table repeating the dates.
    expect(screen.queryByRole("heading", { name: "Details" })).toBeNull();
  });

  it("sets your progress from one dropdown once the job is tracked, and asks for the CV only after applying", () => {
    const onUpdate = vi.fn();
    const entry = (status: "saved" | "applied") => ({ status, updatedAt: "", snapshot: { title: "", company: "", url: "", location: "", score: 0 } });
    // Not tracked: no dropdown, Save in the foot puts it on the board.
    render(<JobDetail job={job()} profile={profile} onUpdate={onUpdate} onClose={() => {}} />);
    expect(screen.queryByLabelText("Your progress")).toBeNull();
    cleanup();
    render(<JobDetail job={job()} entry={entry("saved")} profile={profile} onUpdate={onUpdate} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "CV version sent" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Your progress"), { target: { value: "applied" } });
    expect(onUpdate).toHaveBeenCalledWith({ status: "applied" });
    cleanup();
    render(<JobDetail job={job()} entry={entry("applied")} profile={profile} onUpdate={onUpdate} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "CV version sent" })).toBeTruthy();
  });

  it("lists why a job may be stale near the top, and the meta keeps the plain date", () => {
    const day = 86_400_000;
    const posted = new Date(Date.now() - 130 * day).toISOString();
    const { container } = renderDetail(job({ postedAt: posted, firstSeen: posted, repostedAt: new Date(Date.now() - 5 * day).toISOString() }));
    const heading = screen.getByRole("heading", { name: "May be stale" });
    expect(heading.className).toContain("text-warning-text");
    const items = [...heading.parentElement!.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Posted 4 months ago", expect.stringMatching(/^Taken down and posted again once/)]);
    expect(heading.parentElement!.textContent).toContain("It's still on the company's board, so it may be real.");
    const meta = metaText(container);
    expect(meta).not.toContain("may be filled");
    expect(meta).not.toContain("Reposted");
    expect(meta).toContain("Posted ");
    cleanup();
    // Just old: no callout, the meta says it may be filled as before.
    const { container: c2 } = renderDetail(job({ postedAt: new Date(Date.now() - 70 * day).toISOString() }));
    expect(screen.queryByRole("heading", { name: "May be stale" })).toBeNull();
    expect(metaText(c2)).toContain("may be filled");
  });

  it("marks a role's stale postings, with the callout only when every posting may be stale", () => {
    const reposted = { repostedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), repostCount: 2 };
    const dubai = job({ id: "greenhouse:acme:1", location: "Dubai", ...reposted });
    const london = job({ id: "greenhouse:acme:2", location: "London" });
    const show = (j: Job, postings: Job[]) => render(<JobDetail job={j} postings={postings} profile={profile} onUpdate={() => {}} isNew />);
    // Open on the stale posting: the role is still live in London, so no callout, just the note on Dubai.
    const { container } = show(dubai, [dubai, london]);
    expect(screen.queryByRole("heading", { name: "May be stale" })).toBeNull();
    const notes = screen.getAllByText("may be stale");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.className).toContain("text-warning-text");
    expect(notes[0]!.title).toMatch(/^Taken down and posted again twice/);
    expect(notes[0]!.closest("li")!.textContent).toContain("Dubai");
    expect(metaText(container)).toContain("Reposted");
    cleanup();
    // Both stale: the callout is back, and each posting is marked.
    const londonStale = { ...london, ...reposted };
    show(londonStale, [dubai, londonStale]);
    expect(screen.getByRole("heading", { name: "May be stale" })).toBeTruthy();
    expect(screen.getAllByText("may be stale")).toHaveLength(2);
  });

  it("never uses uppercase classes", () => {
    const { container } = renderDetail(job());
    expect(container.querySelector('[class*="uppercase"]')).toBeNull();
  });

  it("applies at the company by name, with the hiring system in the tooltip", () => {
    renderDetail(job());
    const apply = screen.getByRole("link", { name: /^Apply at / });
    expect(apply.getAttribute("title")).toBe("Apply at Acme, opens the posting on Greenhouse");
    // The name can be cut short with "…", so the label is one truncating span.
    expect(apply.querySelector(".truncate")?.textContent).toBe("Apply at Acme");
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
    render(
      <JobDetail job={job()} entry={{ note: "Ask Sam for a referral", updatedAt: "", snapshot: { title: "", company: "", url: "", location: "", score: 0 } }} profile={profile} onUpdate={() => {}} />,
    );
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Ask Sam for a referral");
  });

  it("keeps Not interested, Hide company and Add company in the More menu, with a labelled Save beside Apply", () => {
    const onUpdate = vi.fn();
    const onHideCompany = vi.fn();
    render(<JobDetail job={job()} profile={profile} onUpdate={onUpdate} onClose={() => {}} onTrack={async () => null} onHideCompany={onHideCompany} />);
    expect(screen.getByRole("button", { name: /^Save/ }).textContent).toContain("Save");
    fireEvent.click(screen.getByRole("button", { name: "More job actions" }));
    expect(screen.getByRole("menuitem", { name: /Add company to My companies/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Hide Acme/ }));
    expect(onHideCompany).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "More job actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Not interested/ }));
    expect(onUpdate).toHaveBeenCalledWith({ status: "dismissed" });
  });

  it("says no description in one line with the way to read it, and hides an empty More from", () => {
    renderDetail(job({ hasDescription: false }));
    expect(screen.queryByRole("heading", { name: "About the role" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the job page" }).getAttribute("href")).toBe("https://acme.example/jobs/1");
    expect(screen.queryByRole("heading", { name: /^More from/ })).toBeNull();
  });

  it("puts where the job is and how fresh it is on one line under the title", () => {
    const { container } = renderDetail(job());
    const meta = container.querySelectorAll(".rj-drawer__meta");
    expect(meta).toHaveLength(1);
    expect(meta[0]!.textContent).toContain("Hybrid");
    expect(meta[0]!.textContent).toMatch(/listed on Greenhouse, checked/);
  });
});

describe("Why it matched", () => {
  const scored = (over: Partial<Job> = {}) => job({ why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, industry: 10 }, ...over });
  // The checklist sits behind Why (remembered once opened).
  const why = () => {
    const section = screen.getByRole("region", { name: "Why it matched" });
    const details = screen.queryByRole("button", { name: "Why" });
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
    const { container } = renderDetail(
      scored({ score: 32, why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, industry: 10, dealbreakers: ["Only for people already living in the United States"] } }),
    );
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
