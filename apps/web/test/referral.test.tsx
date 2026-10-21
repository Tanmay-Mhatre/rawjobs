// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobDetail } from "../src/components/JobDetail";
import { BANNER_DISMISSED_KEY, ConnectBanner } from "../src/components/referral/ConnectBanner";
import { TalkToSomeone } from "../src/components/referral/TalkToSomeone";
import { NetworkSection } from "../src/components/settings/NetworkSection";
import { Toaster } from "../src/components/Toast";
import { isAgencyPosting } from "../src/lib/agency";
import type { Profile } from "../src/lib/data";
import { type NetworkPersonRow, networkChanged, resetNetworkStore, usePeopleAt } from "../src/lib/network";
import { callLinks, coldLinks, companySlug, friendsSearch, profileHref, recruiterLinks, warmLinks } from "../src/lib/referralLinks";
import { makeJob } from "./helpers";

const connected = (ageDays = 2) => ({
  status: { connected: true, importedAt: "2026-10-18T09:00:00.000Z", source: "file", counts: { connections: 812, positions: 2, education: 1, companies: 300 }, ageDays, watch: null },
  me: { positions: [{ company: "Initech", title: "Product Manager", from: "2019-01", to: "2021-12" }], schools: [{ name: "State University" }] },
});
const notConnected = { status: { connected: false, watch: null }, me: null };

const person = (o: Partial<NetworkPersonRow> & { id: string; first: string }): NetworkPersonRow => ({ last: "Example", friend: false, ...o });
/** Ada is a senior PM like the job (high); Grace a recruiter (medium); the rest engineers (low). */
const PEOPLE: NetworkPersonRow[] = [
  person({ id: "u:eng-1", first: "Eve", position: "Engineer", connectedDays: 30 }),
  person({ id: "u:ada", first: "Ada", position: "Senior Product Manager", connectedDays: 1000, url: "https://www.linkedin.com/in/ada" }),
  person({ id: "u:grace", first: "Grace", position: "Recruiter", connectedDays: 10 }),
  ...[2, 3, 4, 5].map((n) => person({ id: `u:eng-${n}`, first: `Eng${n}`, position: "Engineer", connectedDays: 5 })),
];

type Route = (url: string, init?: RequestInit) => unknown;
function stubApi(routes: { network?: unknown; people?: unknown; other?: Route }) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = (v: unknown) => new Response(JSON.stringify(v));
    if (url === "/api/network" && !init?.method) return body(routes.network);
    if (url.startsWith("/api/network/people")) return body(routes.people);
    const other = routes.other?.(url, init);
    return other instanceof Response ? other : body(other ?? { ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  resetNetworkStore();
  // These tests are about the section's own ask, shown once the banner above the job is closed.
  localStorage.setItem(BANNER_DISMISSED_KEY, "true");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem(BANNER_DISMISSED_KEY);
});

describe("People you know, under the job's title", () => {
  const profile = { titles: { include: [], exclude: [] }, keywords: {}, min_score: 65, industries: [], past_employers: [] } as unknown as Profile;
  const detail = (job = makeJob({ company: "Acme" })) => render(<JobDetail job={job} profile={profile} onUpdate={() => {}} />);
  const chip = (name: RegExp) => screen.queryByRole("button", { name });

  it("counts the people you know there, and says when the company match is loose", async () => {
    stubApi({ network: connected(), people: { how: "exact", people: PEOPLE.slice(0, 3) } });
    detail();
    expect(await screen.findByRole("button", { name: "3 you know" })).toBeTruthy();
    cleanup();
    resetNetworkStore();
    stubApi({ network: connected(), people: { how: "prefix", people: PEOPLE.slice(0, 2) } });
    detail();
    expect(await screen.findByRole("button", { name: "2 you may know" })).toBeTruthy();
  });

  it("shows nothing before an import or with nobody there", async () => {
    stubApi({ network: notConnected });
    detail();
    await screen.findByRole("heading", { name: "Talk to someone who works here" });
    expect(chip(/you (may )?know$/)).toBeNull();
    cleanup();
    resetNetworkStore();
    stubApi({ network: connected(), people: { how: "exact", people: [] } });
    detail();
    await screen.findByText(/You don't know anyone at Acme/);
    expect(chip(/you (may )?know$/)).toBeNull();
  });
});

describe("The LinkedIn banner at the top of a job", () => {
  const both = (job = makeJob({ company: "Acme" })) =>
    render(
      <>
        <ConnectBanner job={job} />
        <TalkToSomeone job={job} />
        <Toaster />
      </>,
    );
  beforeEach(() => localStorage.removeItem(BANNER_DISMISSED_KEY));

  it("asks once at the top until closed, then the people section asks instead, everywhere", async () => {
    stubApi({ network: notConnected });
    both();
    expect(await screen.findByRole("heading", { name: "See who you know at Acme" })).toBeTruthy();
    expect(screen.getByText(/nothing is sent anywhere/)).toBeTruthy();
    // Not both at once.
    expect(screen.queryByRole("button", { name: "Connect LinkedIn" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("heading", { name: "See who you know at Acme" })).toBeNull();
    expect(await screen.findByText(/Settings › LinkedIn connections/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect LinkedIn" })).toBeTruthy();
    expect(localStorage.getItem(BANNER_DISMISSED_KEY)).toBe("true");
    cleanup();
    // Another job: still closed.
    both(makeJob({ id: "lever:other:1", company: "Other" }));
    expect(await screen.findByRole("button", { name: "Connect LinkedIn" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /See who you know/ })).toBeNull();
  });

  it("opens the import dialog, and never shows once connected or for an agency", async () => {
    stubApi({ network: notConnected });
    both();
    await userEvent.click(await screen.findByRole("button", { name: "Import connections" }));
    expect(screen.getByRole("dialog", { name: "Connect LinkedIn" })).toBeTruthy();
    cleanup();
    resetNetworkStore();
    stubApi({ network: connected(), people: { how: "exact", people: [] } });
    both();
    await screen.findByText(/You don't know anyone at Acme/);
    expect(screen.queryByRole("heading", { name: /See who you know/ })).toBeNull();
  });
});

describe("Talk to someone who works here", () => {
  it("asks to connect LinkedIn when there's no import, with search links folded", async () => {
    const fetch = stubApi({ network: notConnected });
    render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    expect(await screen.findByText(/Connect LinkedIn to see who you already know at Acme/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect LinkedIn" })).toBeTruthy();
    expect(screen.getByText("More ways in")).toBeTruthy();
    // Never asks for people before there's an import.
    expect(fetch.mock.calls.some(([u]) => String(u).includes("/people"))).toBe(false);
    expect(screen.getByText("Book a call")).toBeTruthy();
    expect(screen.getByText("For advice, not referrals")).toBeTruthy();
    const adplist = screen.getByRole("link", { name: "Free mentors at Acme (opens ADPList)" });
    expect(adplist.getAttribute("href")).toBe("https://adplist.org/mentors/company/acme");
    expect(adplist.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Paid calls on Topmate (opens Topmate)" }).getAttribute("href")).toBe("https://topmate.io/s/acme");
    expect(screen.getByText("Pay for advice, never for a referral. Most companies don't allow paid referrals.")).toBeTruthy();
  });

  it("offers Book a call when connected too", async () => {
    stubApi({ network: connected(), people: { how: "none", people: [] } });
    render(<TalkToSomeone job={makeJob({ company: "Procter & Gamble" })} />);
    await screen.findByText(/You don't know anyone at Procter & Gamble/);
    expect(screen.getByRole("link", { name: "Free mentors at Procter & Gamble (opens ADPList)" }).getAttribute("href")).toBe("https://adplist.org/mentors/company/procter-gamble");
    expect(screen.getByText("Topmate searches service titles, not employers. Check each profile.")).toBeTruthy();
  });

  it("ranks the people you know, top 5 first, with the band and why", async () => {
    stubApi({ network: connected(), people: { how: "exact", people: PEOPLE } });
    render(<TalkToSomeone job={makeJob({ company: "Acme", title: "Senior Product Manager", seniority: "senior" })} />);
    const list = await screen.findByRole("list", { name: "People you know at Acme" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toMatch(/^Ada Example/);
    expect(rows[0]!.textContent).toContain("Likely to help: high");
    expect(rows[0]!.textContent).toContain("You're connected on LinkedIn. Works in");
    expect(within(rows[0]!).getByRole("link", { name: "Ada Example" }).getAttribute("href")).toBe("https://www.linkedin.com/in/ada");
    expect(rows[1]!.textContent).toMatch(/^Grace Example/);
    expect(rows[1]!.textContent).toContain("Likely to help: medium");

    // "More": how the score is worked out, with the thresholds.
    const more = within(rows[0]!).getByText("How this is worked out").closest("details")!;
    expect(more.textContent).toContain("+40You're connected on LinkedIn");
    expect(more.textContent).toContain("60 or more is high, 35 to 59 medium, under 35 low.");

    // Show all moves focus to the 6th row.
    await userEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(document.activeElement).toBe(within(list).getAllByRole("listitem")[5]);
  });

  it("marks a close contact with aria-pressed and saves it", async () => {
    const fetch = stubApi({ network: connected(), people: { how: "exact", people: PEOPLE.slice(0, 2) } });
    render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    const toggle = await screen.findByRole("button", { name: "Mark Ada Example as a close contact" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Mark Ada Example as a close contact" }).getAttribute("aria-pressed")).toBe("true");
    const put = fetch.mock.calls.find(([u]) => u === "/api/network/friends")!;
    expect(put[1]).toMatchObject({ method: "PUT", body: JSON.stringify({ id: "u:ada", friend: true }) });
  });

  it("says when you know nobody there", async () => {
    stubApi({ network: connected(), people: { how: "none", people: [] } });
    render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    expect(await screen.findByText("You don't know anyone at Acme on LinkedIn yet. These searches find people one step away.")).toBeTruthy();
  });

  it("reminds you to get a fresh copy: muted from 30 days, warning from 60", async () => {
    stubApi({ network: connected(35), people: { how: "none", people: [] } });
    const { unmount } = render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    const muted = await screen.findByText(/Connections imported 35 days ago/);
    expect(muted.className).toContain("text-muted");
    unmount();
    resetNetworkStore();
    stubApi({ network: connected(65), people: { how: "none", people: [] } });
    render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    expect((await screen.findByText(/Connections imported 65 days ago/)).className).toContain("text-warning-text");
  });

  it("on an agency's posting, explains and links only to recruiters", async () => {
    const fetch = stubApi({ network: connected(), people: { how: "exact", people: PEOPLE } });
    render(<TalkToSomeone job={makeJob({ company: "Hays Recruitment", ats: "greenhouse" })} />);
    expect(screen.getByText(/A recruitment agency posted this and may not name the employer/)).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Recruiters there"]);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls.some(([u]) => String(u).includes("/people"))).toBe(false);
  });

  it("is hidden on a Not interested job", () => {
    stubApi({ network: connected() });
    const { container } = render(<TalkToSomeone job={makeJob()} entry={{ status: "dismissed", updatedAt: "2026-10-20T00:00:00.000Z" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("usePeopleAt", () => {
  it("asks once per company, however many panels show it", async () => {
    const fetch = stubApi({ people: { how: "exact", people: PEOPLE.slice(0, 1) } });
    const a = renderHook(() => usePeopleAt("Acme", true));
    const b = renderHook(() => usePeopleAt("Acme Inc.", true));
    await waitFor(() => expect(a.result.current?.state).toBe("ready"));
    expect(b.result.current?.state).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that arrives after an import or delete", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url.startsWith("/api/network/people") ? new Promise<Response>((r) => (answer = r)) : Promise.resolve(new Response(JSON.stringify(notConnected))))),
    );
    const { result } = renderHook(() => usePeopleAt("Acme", true));
    expect(result.current?.state).toBe("loading");
    const late = answer;
    act(() => networkChanged());
    await act(async () => late(new Response(JSON.stringify({ how: "exact", people: PEOPLE }))));
    expect(result.current?.state).not.toBe("ready");
  });

  it("asks nothing when not enabled", () => {
    const fetch = stubApi({});
    const { result } = renderHook(() => usePeopleAt("Acme", false));
    expect(result.current).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Settings > LinkedIn connections", () => {
  it("offers Connect LinkedIn before an import", async () => {
    stubApi({ network: notConnected });
    render(<NetworkSection />);
    expect(await screen.findByRole("button", { name: "Connect LinkedIn" })).toBeTruthy();
  });

  it("imports Connections.csv from the dialog and shows what came in", async () => {
    let imported: unknown;
    const fetch = stubApi({
      network: notConnected,
      other: (url, init) => {
        if (url === "/api/network/import") {
          imported = JSON.parse(String(init?.body));
          return { ok: true, status: connected().status };
        }
      },
    });
    render(<NetworkSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect LinkedIn" }));
    const csv = new File(["First Name,Last Name,URL,Company\nAda,Lovelace,,Acme\n"], "Connections.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/LinkedIn export ZIP|Connections\.csv/), csv);
    expect(await screen.findByText("Imported 812 connections, 2 positions and 1 school.")).toBeTruthy();
    expect(imported).toEqual({ fileName: "Connections.csv", files: { connections: "First Name,Last Name,URL,Company\nAda,Lovelace,,Acme\n" } });
    expect(fetch.mock.calls.filter(([u]) => u === "/api/network/import")).toHaveLength(1);
  });

  it("explains an import error in plain words", async () => {
    stubApi({
      network: notConnected,
      other: (url) => (url === "/api/network/import" ? new Response(JSON.stringify({ ok: false, errors: [{ code: "NO_CONNECTIONS" }] }), { status: 400 }) : undefined),
    });
    render(<NetworkSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect LinkedIn" }));
    await userEvent.upload(screen.getByLabelText(/LinkedIn export ZIP|Connections\.csv/), new File(["x"], "Connections.csv"));
    expect((await screen.findByRole("alert")).textContent).toBe("That ZIP has no Connections.csv. Request the archive again with Connections ticked.");
  });

  it("shows the count and date, and deletes only after the confirm", async () => {
    const fetch = stubApi({ network: connected(40) });
    render(<NetworkSection />);
    expect((await screen.findByText(/connections · imported/)).textContent).toMatch(/812 connections · imported/);
    expect(screen.getByText("It's been 40 days. Get a fresh copy so new jobs and people show up.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your LinkedIn connections?" });
    expect(dialog.textContent).toContain("they're in its browser copy, its backups and its exports");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete connections" }));
    expect(fetch.mock.calls.filter(([u, init]) => u === "/api/network" && init?.method === "DELETE")).toHaveLength(1);
  });
});

describe("Downloads watch", () => {
  const WATCH = { since: "2026-10-20T10:00:00.000Z", until: "2026-10-21T10:00:00.000Z", folder: "Downloads" };
  const openDialog = async () => {
    render(<NetworkSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect LinkedIn" }));
    return screen.getByRole("dialog", { name: "Connect LinkedIn" });
  };

  it("offers to pick up the file (on by default) and starts watching as LinkedIn's page opens", async () => {
    const fetch = stubApi({ network: { ...notConnected, watchable: true }, other: (url, init) => (url === "/api/network/watch" && init?.method === "POST" ? { watch: WATCH } : undefined) });
    const dialog = await openDialog();
    const box = within(dialog).getByRole("checkbox", { name: /Pick up the file from my Downloads folder by itself/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(dialog.textContent).toContain("RawJobs looks only for LinkedIn's file name");
    await userEvent.click(within(dialog).getByRole("link", { name: /Open LinkedIn's data page/ }));
    expect(fetch.mock.calls.filter(([u, init]) => u === "/api/network/watch" && init?.method === "POST")).toHaveLength(1);
    expect((await within(dialog).findByRole("status")).textContent).toBe("Watching Downloads for Basic_LinkedInDataExport_….zip");
    // The drop zone is still there, and the box is gone once watching.
    expect(within(dialog).getByRole("button", { name: /Choose the ZIP file|Choose Connections\.csv/ })).toBeTruthy();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("doesn't watch when the box is unticked, and hides it where it isn't offered", async () => {
    const fetch = stubApi({ network: { ...notConnected, watchable: true } });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("link", { name: /Open LinkedIn's data page/ }));
    expect(fetch.mock.calls.some(([u]) => u === "/api/network/watch")).toBe(false);
    cleanup();
    resetNetworkStore();
    stubApi({ network: { ...notConnected, watchable: false } });
    const mac = await openDialog();
    expect(within(mac).queryByRole("checkbox")).toBeNull();
  });

  it("says so when RawJobs can't look in Downloads", async () => {
    stubApi({
      network: { ...notConnected, watchable: true },
      other: (url) => (url === "/api/network/watch" ? new Response(JSON.stringify({ watch: null, error: "NO_ACCESS" }), { status: 400 }) : undefined),
    });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("link", { name: /Open LinkedIn's data page/ }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("RawJobs can't look in Downloads. Choose the file instead.");
  });

  it("shows the watch in the panel with Stop, and Stop ends it", async () => {
    const fetch = stubApi({ network: { status: { connected: false, watch: WATCH }, me: null, watchable: true } });
    render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
    const line = await screen.findByText(/Watching Downloads until/);
    await userEvent.click(within(line).getByRole("button", { name: "Stop" }));
    expect(fetch.mock.calls.filter(([u, init]) => u === "/api/network/watch" && init?.method === "DELETE")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/Watching Downloads until/)).toBeNull());
  });

  it("asks every 10 s while watching, then refreshes and says what came in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const routes: { network: unknown } = { network: { status: { connected: false, watch: WATCH }, me: null, watchable: true } };
      const fetch = stubApi(routes);
      render(<Toaster />);
      render(<TalkToSomeone job={makeJob({ company: "Acme" })} />);
      await screen.findByText(/Watching Downloads until/);
      const reads = () => fetch.mock.calls.filter(([u, init]) => u === "/api/network" && !init?.method).length;
      expect(reads()).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(reads()).toBe(2);
      routes.network = { ...connected(), status: { ...connected().status, source: "downloads" } };
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(await screen.findByText("Imported 812 connections from Downloads")).toBeTruthy();
      await waitFor(() => expect(screen.queryByText(/Watching Downloads until/)).toBeNull());
      // Once the watch is over, it stops asking.
      const after = reads();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(reads()).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("search links", () => {
  it("builds exact, encoded LinkedIn and Blind searches", () => {
    expect(friendsSearch("Acme")).toBe("https://www.linkedin.com/search/results/people/?keywords=%22Acme%22&network=%5B%22F%22%2C%22S%22%5D");
    const warm = warmLinks({ company: "Acme", title: "PM", schools: ["State University"], pastEmployers: ["Initech", "Acme"] });
    expect(warm.map((l) => l.href)).toEqual([
      "https://www.linkedin.com/search/results/people/?keywords=%22Acme%22&network=%5B%22F%22%2C%22S%22%5D",
      "https://www.linkedin.com/search/results/people/?keywords=%22Acme%22&network=%5B%22S%22%5D",
      "https://www.linkedin.com/search/results/people/?keywords=%22Acme%22%20%22State%20University%22",
      "https://www.linkedin.com/search/results/people/?keywords=%22Acme%22%20%22Initech%22",
    ]);
    expect(coldLinks({ company: "AT&T", title: "Senior PM" }).map((l) => l.href)).toEqual([
      "https://www.linkedin.com/search/results/people/?keywords=%22AT%26T%22%20Senior%20PM",
      "https://www.linkedin.com/search/results/people/?keywords=%22AT%26T%22%20(recruiter%20OR%20%22talent%20acquisition%22)",
      "https://www.linkedin.com/search/results/content/?keywords=%22AT%26T%22%20hiring&datePosted=%22past-month%22",
      "https://www.teamblind.com/search/AT%26T%20referral",
    ]);
    expect(recruiterLinks("Acme")).toHaveLength(1);
  });

  it("never lets a name break out of its query", () => {
    for (const l of [...warmLinks({ company: 'x"&network=evil#', title: "a/b?c", schools: ["s&t"], pastEmployers: ["p#q"] }), ...coldLinks({ company: "x?y#z", title: "t&u" })]) {
      const u = new URL(l.href);
      expect(u.hash).toBe("");
      expect([...u.searchParams.keys()].every((k) => ["keywords", "network", "datePosted"].includes(k))).toBe(true);
    }
  });

  it("slugs company names for the call links", () => {
    expect(companySlug("AT&T")).toBe("at-t");
    expect(companySlug("Procter & Gamble")).toBe("procter-gamble");
    expect(companySlug("  J.P. Morgan Chase & Co. ")).toBe("j-p-morgan-chase-co");
    expect(companySlug("Nestlé")).toBe("nestle");
    expect(companySlug("日立製作所")).toBe("日立製作所");
    expect(companySlug("삼성전자")).toBe("삼성전자");
    expect(companySlug("&&")).toBe("");
    expect(callLinks("AT&T").map((l) => l.href)).toEqual(["https://adplist.org/mentors/company/at-t", "https://topmate.io/s/at-t"]);
    expect(callLinks("日立").map((l) => l.href)).toEqual(["https://adplist.org/mentors/company/%E6%97%A5%E7%AB%8B", "https://topmate.io/s/%E6%97%A5%E7%AB%8B"]);
    expect(callLinks("?#/")).toEqual([]);
  });

  it("links only real LinkedIn profiles", () => {
    expect(profileHref("https://www.linkedin.com/in/ada")).toBe("https://www.linkedin.com/in/ada");
    expect(profileHref("https://www.linkedin.com/company/acme")).toBeUndefined();
    expect(profileHref("javascript:alert(1)")).toBeUndefined();
    expect(profileHref("https://evil.example/in/ada")).toBeUndefined();
  });

  it("spots agency postings", () => {
    expect(isAgencyPosting({ ats: "bullhorn", company: "Anything" })).toBe(true);
    expect(isAgencyPosting({ ats: "greenhouse", company: "Hays Recruitment" })).toBe(true);
    expect(isAgencyPosting({ ats: "greenhouse", company: "Acme" })).toBe(false);
  });
});

describe("components/referral", () => {
  it("never uses dangerouslySetInnerHTML", () => {
    const dir = join(__dirname, "../src/components/referral");
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("dangerouslySetInnerHTML");
  });
});
