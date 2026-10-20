// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));
import { resetPasted } from "../src/components/referral/FindFriends";
import { TalkToSomeone } from "../src/components/referral/TalkToSomeone";
import { toast } from "../src/components/Toast";
import { resetNetworkStore } from "../src/lib/network";
import type { Entry, EntryPatch } from "../src/lib/userState";
import { makeJob } from "./helpers";

const job = makeJob({ id: "greenhouse:acme:1", company: "Acme", title: "Senior Product Manager" });
const SEARCH = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('"Acme"')}&network=${encodeURIComponent('["F","S"]')}`;

const PASTE = [
  "Skip to main content",
  "Home",
  "My Network",
  "About 3 results",
  "View Ada Lovelace’s profile",
  "Ada Lovelace",
  "• 1st",
  "1st degree connection",
  "Senior Product Manager at Acme",
  "London, United Kingdom",
  "Message",
  "View Grace Hopper’s profile",
  "Grace Hopper",
  "• 2nd",
  "2nd degree connection",
  "Engineering Manager at Acme",
  "New York, United States",
  "Linus Example and 3 other mutual connections",
  "Connect",
  "View Alan Turing’s profile",
  "Alan Turing",
  "• 3rd+",
  "Researcher at Acme",
  "Connect",
].join("\n");

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: { connected: false, watch: null }, me: null }))),
  );
}

function mount(entry?: Entry) {
  const onUpdate = vi.fn<(p: EntryPatch) => void>();
  render(<TalkToSomeone job={job} entry={entry} onUpdate={onUpdate} />);
  return onUpdate;
}

function paste(text: string) {
  const box = screen.getByLabelText("Paste LinkedIn search results");
  fireEvent.paste(box, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  resetNetworkStore();
  resetPasted();
  stubApi();
  vi.mocked(toast).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Find friends at {Company}", () => {
  it("opens LinkedIn's 1st and 2nd search for the company and shows the paste box, even when not connected", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    expect(open).toHaveBeenCalledWith(SEARCH, "rawjobs-linkedin");
    expect(screen.getByLabelText("Paste LinkedIn search results")).toBeTruthy();
    expect(screen.getByText(/press (Ctrl|Cmd)\+A then (Ctrl|Cmd)\+C/)).toBeTruthy();
    expect(screen.queryByText(/blocked the LinkedIn window/)).toBeNull();
  });

  it("says when the browser blocked the window, and still shows the paste box", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    expect(screen.getByText("Your browser blocked the LinkedIn window. Allow pop-ups for RawJobs, or use the search links.")).toBeTruthy();
    expect(screen.getByLabelText("Paste LinkedIn search results")).toBeTruthy();
  });

  it("reads a paste: counts, rows with degree and mutual line, 3rd+ dropped, and never touches storage", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const set = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    paste(PASTE);
    expect(screen.getByRole("status").textContent).toBe("Found 2 people: 1 1st, 1 2nd");
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Senior Product Manager at Acme")).toBeTruthy();
    expect(screen.getByText("Linus Example and 3 others know them")).toBeTruthy();
    expect(screen.queryByText("Alan Turing")).toBeNull();
    expect(screen.getByText("Gone when you reload.")).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it("adds a 1st connection as To contact with degree 1", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const onUpdate = mount({ status: "saved", updatedAt: "2026-10-10T09:00:00.000Z" });
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    paste(PASTE);
    await userEvent.click(screen.getByRole("button", { name: "Add to contacts" }));
    const patch = onUpdate.mock.calls[0]![0];
    const c = patch.contacts![0]!;
    expect(c).toMatchObject({ name: "Ada Lovelace", role: "referrer", company: "Acme" });
    expect(patch.outreach![c.id]).toMatchObject({ stage: "to-contact", via: "linkedin", degree: 1 });
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Added Ada Lovelace to this job");
  });

  it("copies the intro message for a 2nd connection and adds them with the mutual", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const onUpdate = mount({ status: "saved", updatedAt: "2026-10-10T09:00:00.000Z" });
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    paste(PASTE);
    await userEvent.click(screen.getByRole("button", { name: "Ask Linus Example to introduce you" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith(
      "Hi Linus, I see you know Grace at Acme. I'm applying for their Senior Product Manager role. Would you be comfortable introducing us? Happy to send a short blurb you can forward.",
    );
    const patch = onUpdate.mock.calls[0]![0];
    const c = patch.contacts![0]!;
    expect(c.name).toBe("Grace Hopper");
    expect(patch.outreach![c.id]).toMatchObject({ stage: "to-contact", degree: 2, mutual: "Linus Example" });
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Copied the intro message. Added Grace Hopper to this job");
  });

  it("explains an empty or non-English paste, typed and read with the button, and Clear empties it", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    paste("Home\nMy Network\nAlan Turing\n• 3rd+\nResearcher at Acme");
    expect(screen.getByRole("status").textContent).toBe("No people found. Only 1st and 2nd connections show here.");

    await userEvent.type(screen.getByLabelText("Paste LinkedIn search results"), "Ada Lovelace{enter}Relation de 1er niveau");
    await userEvent.click(screen.getByRole("button", { name: "Find my friends" }));
    expect(screen.getByRole("status").textContent).toBe("Set LinkedIn to English to use this.");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps results in memory across remounts, keyed by company", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Find friends at Acme" }));
    paste(PASTE);
    cleanup();
    mount();
    expect(screen.getByRole("status").textContent).toBe("Found 2 people: 1 1st, 1 2nd");
  });

  it("is hidden on an agency's posting", () => {
    render(<TalkToSomeone job={makeJob({ company: "Hays Recruitment", ats: "greenhouse" })} />);
    expect(screen.queryByRole("button", { name: /Find friends at/ })).toBeNull();
  });
});
