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

  it("leads with the decision facts, saying when one isn't known", () => {
    const { container } = renderDetail(job());
    const facts = [...container.querySelectorAll(".rj-fact dt")].map((d) => d.textContent);
    expect(facts).toEqual(["Salary", "Work mode", "Seniority", "Who can apply", "Company hiring", "Type"]);
    expect(container.querySelector(".rj-fact")!.textContent).toContain("Not listed");
  });

  it("sets your progress from one dropdown", () => {
    const onUpdate = vi.fn();
    render(<JobDetail job={job()} profile={profile} onUpdate={onUpdate} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Your progress"), { target: { value: "applied" } });
    expect(onUpdate).toHaveBeenCalledWith({ status: "applied" });
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
    expect(apply.getAttribute("title")).toBe("Opens the posting on Greenhouse");
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

  it("keeps Add company and Copy description in the More menu, and has no menu with nothing in it", () => {
    renderDetail(job());
    expect(screen.queryByRole("button", { name: "More job actions" })).toBeNull();
    cleanup();
    render(<JobDetail job={job()} profile={profile} onUpdate={() => {}} onTrack={async () => null} />);
    fireEvent.click(screen.getByRole("button", { name: "More job actions" }));
    expect(screen.getByRole("menuitem", { name: /Add company to My companies/ })).toBeTruthy();
  });

  it("puts Not interested in the foot, next to Save", () => {
    const onUpdate = vi.fn();
    render(<JobDetail job={job()} profile={profile} onUpdate={onUpdate} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Not interested/ }));
    expect(onUpdate).toHaveBeenCalledWith({ status: "dismissed" });
  });

  it("puts where and what the job is on one plain line under the title", () => {
    const { container } = renderDetail(job());
    const meta = container.querySelector(".rj-drawer__meta");
    expect(meta?.textContent).toContain("Hybrid");
    expect(meta?.querySelectorAll(".rj-sep").length).toBeGreaterThan(1);
  });
});

describe("Why it matched", () => {
  const scored = (over: Partial<Job> = {}) => job({ why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, industry: 10 }, ...over });
  // The checklist sits behind Show breakdown (remembered once opened).
  const why = () => {
    const section = screen.getByRole("heading", { name: "Why it matched" }).closest("section")!;
    const details = screen.queryByRole("button", { name: "Show breakdown" });
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
