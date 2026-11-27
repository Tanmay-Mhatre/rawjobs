// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobDrawer } from "../src/components/JobDrawer";
import type { JobDetailProps } from "../src/components/JobDetail";
import { makeJob } from "./helpers";

// A job whose details can't be shown (bad data, a bug in one section).
vi.mock("../src/components/JobDetail", () => ({
  JobDetail: () => {
    throw new Error("This job's details broke");
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The page around the drawer: a header with the nav, and a job open in the drawer. */
function Page() {
  const [open, setOpen] = useState(true);
  const props = { job: makeJob({ id: "lever:acme:1", title: "Head of Product" }) } as JobDetailProps;
  return (
    <>
      <header>
        <nav aria-label="Sections">
          <button type="button">Radar</button>
        </nav>
      </header>
      {open && <JobDrawer {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

describe("the job drawer's error boundary", () => {
  it('a JobDetail that throws inside the drawer shows "Something went wrong on this job" and the header and nav stay', () => {
    render(<Page />);
    expect(screen.getByText("Something went wrong on this job")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Sections", hidden: true })).toBeTruthy();
    expect(screen.queryByText("Something went wrong on RawJobs")).toBeNull();
  });

  it("Esc still closes the drawer after a crash", () => {
    render(<Page />);
    const drawer = document.querySelector("dialog")!;
    expect(drawer.getAttribute("aria-label")).toBe("Head of Product");
    // Escape on a modal <dialog> fires "cancel"; the Dialog turns it into onClose.
    fireEvent(drawer, new Event("cancel", { cancelable: true }));
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.queryByText("Something went wrong on this job")).toBeNull();
  });

  it("the error card has its own Close, since JobDetail's close button broke with it (phones have no Esc)", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
    expect(document.querySelector("dialog")).toBeNull();
  });
});
