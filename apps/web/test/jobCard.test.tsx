// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobCard } from "../src/components/radar/JobCard";
import type { Job } from "../src/lib/data";
import { shortAge } from "../src/lib/format";
import { makeJob } from "./helpers";

afterEach(cleanup);

const DAY = 86_400_000;
const job = (over: Partial<Job> = {}): Job =>
  makeJob({
    id: "greenhouse:acme:1",
    company: "Acme Exchange",
    title: "Head of Product, Exchange",
    workplace: "hybrid",
    postedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    score: 74,
    why: { title: 30, location: 20, keywords: ["payments"], keywordPoints: 14, freshness: 10 },
    group: "Acme|head of product",
    hasDescription: true,
    ...over,
  });

function renderRow(over: Partial<Parameters<typeof JobCard>[0]> = {}) {
  const lead = job();
  const props = { group: { key: lead.group, lead, jobs: [lead] }, min: 65, isNew: true, selected: false, onSelect: vi.fn(), onStatus: vi.fn(), yours: true, ...over };
  return {
    props,
    ...render(
      <ul>
        <JobCard {...props} />
      </ul>,
    ),
  };
}

describe("feed row (design/components/Feed)", () => {
  it("reads score, then title and meta, then actions and source", () => {
    const { container } = renderRow();
    const row = container.querySelector("li.rj-row")!;
    expect([...row.children].map((c) => c.className.split(" ")[0] || c.firstElementChild?.className.split(" ")[0])).toEqual(["rj-score", "rj-row__main", "rj-row__side"]);
    expect(screen.getByRole("img", { name: "Strong match, score 74" })).toBeTruthy();
    expect(container.querySelector(".rj-row__meta")!.textContent).toBe("Acme Exchange·Dubai·Hybrid");
    // Where it came from and how old it is; the new dot has a name.
    expect(container.querySelector(".rj-source")!.textContent).toBe("Greenhouse2d");
    expect(screen.getByRole("img", { name: "New this scan" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "My company" }).getAttribute("class")).toContain("rj-star");
  });

  it("has no letter tile, no Matches line and no orange", () => {
    const { container } = renderRow({ selected: true });
    expect(container.textContent).not.toContain("Matches:");
    expect(container.innerHTML).not.toMatch(/accent/);
    expect(container.querySelector("li")!.getAttribute("aria-current")).toBe("true");
  });

  it("has two row actions, Save and Not interested, with their keys", async () => {
    const { props } = renderRow({ entry: { status: "saved", updatedAt: "" } as never });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-pressed")).toBe("true");
    expect(save.title).toBe("Save (S)");
    await userEvent.click(screen.getByRole("button", { name: "Not interested" }));
    expect(props.onStatus).toHaveBeenCalledWith("dismissed");
    expect(screen.getAllByRole("button")).toHaveLength(3); // the title, Save, Not interested
  });

  it("says which dealbreaker a job breaks, in the warning treatment", () => {
    const lead = job({
      score: 37,
      why: { title: 30, location: 20, keywords: [], keywordPoints: 14, industry: 10, dealbreakers: ["Pay below your floor: up to EUR 55k vs your 60k a year", "About agency, which you avoid"] },
    });
    const { container } = render(
      <ul>
        <JobCard group={{ key: lead.group, lead, jobs: [lead] }} min={65} isNew={false} selected={false} onSelect={vi.fn()} onStatus={vi.fn()} />
      </ul>,
    );
    const note = screen.getByText(/Pay below your floor/);
    expect(note.className).toBe("text-warning-text");
    expect(note.textContent).toBe("Pay below your floor: up to EUR 55k vs your 60k a year +1");
    expect(note.getAttribute("title")).toContain("About agency, which you avoid");
    expect(container.querySelector("li")!.className).not.toContain("opacity-60");
  });

  it("the title is the button that opens the job", async () => {
    const { props } = renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Head of Product, Exchange" }));
    expect(props.onSelect).toHaveBeenCalledOnce();
  });
});

describe("shortAge", () => {
  it("drops 'ago' for source tags", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(shortAge("2026-10-07T12:00:00Z", now)).toBe("2d");
    expect(shortAge("2026-10-09T09:00:00Z", now)).toBe("3h");
    expect(shortAge("2026-10-09T11:59:30Z", now)).toBe("now");
  });
});
