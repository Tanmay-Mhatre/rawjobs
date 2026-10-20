// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));
import { JobTracking } from "../src/components/pipeline/JobTracking";
import { JobCard } from "../src/components/radar/JobCard";
import { TalkToSomeone } from "../src/components/referral/TalkToSomeone";
import { toast } from "../src/components/Toast";
import { type NetworkPersonRow, resetNetworkStore } from "../src/lib/network";
import { applyPatch, capEntry, type Entry, type EntryPatch, mergeStates, readStateFile, referralWord, type UserState } from "../src/lib/userState";
import { makeJob } from "./helpers";

const job = makeJob({ id: "greenhouse:acme:1", company: "Acme", title: "Senior Product Manager" });
const snapshot = { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score };
const entry = (o: Partial<Entry> = {}): Entry => ({ status: "saved", updatedAt: "2026-10-10T09:00:00.000Z", snapshot, ...o });
const ask = (stage: "to-contact" | "messaged" | "replied" | "referred", at = "2026-10-12T09:00:00.000Z") => ({ stage, via: "linkedin" as const, at });
const priya = { id: "p1", name: "Priya Shah", role: "referrer" as const, company: "Acme" };

beforeEach(() => {
  resetNetworkStore();
  vi.mocked(toast).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Entry.outreach survives every path", () => {
  it("drops a stage when its person leaves the job, in applyPatch and capEntry", () => {
    const e = entry({ contacts: [priya], outreach: { p1: ask("messaged") } });
    expect(applyPatch(e, job, { contacts: [] })?.outreach).toBeUndefined();
    expect(capEntry({ ...e, outreach: { ...e.outreach, gone: ask("replied") } }).outreach).toEqual({ p1: ask("messaged") });
  });

  it("follows a v1 person renamed in a merge, and joins stages with the later change winning", () => {
    const v1 = `v1:${job.id}:0`;
    const mine: UserState = { [job.id]: entry({ contacts: [{ id: v1, name: "Priya" }, priya], outreach: { [v1]: ask("to-contact"), p1: ask("messaged", "2026-10-15T09:00:00.000Z") } }) };
    const theirs: UserState = {
      [job.id]: entry({
        updatedAt: "2026-10-12T09:00:00.000Z",
        contacts: [{ id: v1, name: "Sam" }, priya],
        outreach: { [v1]: ask("replied"), p1: ask("referred", "2026-10-13T09:00:00.000Z") },
      }),
    };
    const m = mergeStates(mine, theirs, new Date("2026-10-20T12:00:00Z"))[job.id]!;
    const sam = m.contacts!.find((c) => c.name === "Sam")!;
    expect(sam.id).not.toBe(v1);
    expect(m.outreach![sam.id]!.stage).toBe("replied");
    expect(m.outreach![v1]!.stage).toBe("to-contact");
    expect(m.outreach!.p1!.stage).toBe("messaged");
  });

  it("comes back from an export, checked, and keeps fields this version doesn't know", async () => {
    const out = entry({ contacts: [priya], outreach: { p1: { ...ask("messaged"), networkId: "u:priya", degree: 2, mutual: "Ada" } } });
    const file = new File(
      [
        JSON.stringify({
          app: "rawjobs",
          version: 2,
          state: {
            [job.id]: {
              ...out,
              outreach: { ...out.outreach, gone: ask("replied") },
              laterField: { kept: true },
            },
            other: { ...entry({ contacts: [priya] }), outreach: { p1: { stage: "begged", at: "2026-10-12T09:00:00.000Z" } } },
          },
        }),
      ],
      "export.json",
    );
    const { state } = await readStateFile(file, new Date("2026-10-20T12:00:00Z"));
    expect(state[job.id]!.outreach).toEqual(out.outreach);
    expect((state[job.id] as Entry & { laterField?: unknown }).laterField).toEqual({ kept: true });
    expect(state.other!.outreach).toBeUndefined();
  });

  it("words the Radar stage from Messaged on, the furthest one", () => {
    expect(referralWord(entry({ outreach: { a: ask("to-contact") } }))).toBeUndefined();
    expect(referralWord(entry({ outreach: { a: ask("messaged"), b: ask("replied") } }))).toBe("Replied");
    expect(referralWord(entry({ outreach: { a: ask("referred") } }))).toBe("Referred");
  });
});

describe("Radar row", () => {
  it("shows the referral stage after the status", () => {
    render(
      <ul>
        <JobCard
          group={{ key: "g", lead: job, jobs: [job] }}
          entry={entry({ contacts: [priya], outreach: { p1: ask("messaged") } })}
          min={0}
          isNew={false}
          selected={false}
          onSelect={vi.fn()}
          onStatus={vi.fn()}
          yours
        />
      </ul>,
    );
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Messaged")).toBeTruthy();
  });
});

const ada: NetworkPersonRow = { id: "u:ada", first: "Ada", last: "Example", friend: false, company: "Acme", position: "Senior Product Manager", url: "https://www.linkedin.com/in/ada" };
function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = (v: unknown) => new Response(JSON.stringify(v));
      if (url === "/api/network")
        return body({
          status: { connected: true, importedAt: "2026-10-18T09:00:00.000Z", source: "file", counts: { connections: 1, positions: 0, education: 0, companies: 1 }, ageDays: 2, watch: null },
          me: { positions: [], schools: [] },
        });
      if (url.startsWith("/api/network/people")) return body({ how: "exact", people: [ada] });
      return body({ ok: true });
    }),
  );
}

/** The section over a real entry: each patch goes through applyPatch, as the app does. */
function Section({ start, onPatch, onOpenPeople }: { start?: Entry; onPatch: (p: EntryPatch) => void; onOpenPeople?: () => void }) {
  const [e, setE] = useState<Entry | undefined>(start);
  return (
    <TalkToSomeone
      job={job}
      entry={e}
      onOpenPeople={onOpenPeople}
      onUpdate={(p) => {
        onPatch(p);
        setE((prev) => applyPatch(prev, job, p) ?? undefined);
      }}
    />
  );
}

describe("Talk to someone: adding a contact", () => {
  it("saves an unsaved job with the first person, says so, and Undo puts it back", async () => {
    stubApi();
    const patches: EntryPatch[] = [];
    const onOpenPeople = vi.fn();
    render(<Section onPatch={(p) => patches.push(p)} onOpenPeople={onOpenPeople} />);
    await userEvent.click(await screen.findByText("More"));
    await userEvent.click(screen.getByRole("button", { name: "Add to contacts" }));

    expect(patches[0]).toMatchObject({ status: "saved", contacts: [{ name: "Ada Example", role: "referrer", linkedin: "https://www.linkedin.com/in/ada" }] });
    const cid = patches[0]!.contacts![0]!.id;
    expect(patches[0]!.outreach![cid]).toMatchObject({ stage: "to-contact", via: "linkedin", networkId: "u:ada" });
    const t = vi.mocked(toast).mock.calls[0]![0];
    expect(t.message).toBe("Saved this job and added Ada Example");

    // Once added, the row says where it stands and opens the People tab: never a stage control here.
    const list = screen.getByRole("list", { name: "People you know at Acme" });
    await userEvent.click(within(list).getByRole("button", { name: "On this job: To contact" }));
    expect(onOpenPeople).toHaveBeenCalled();
    expect(within(list).queryByRole("combobox")).toBeNull();
    expect(within(list).queryByRole("button", { name: "Add to contacts" })).toBeNull();

    t.onAction!();
    expect(patches[1]).toEqual({ status: undefined, contacts: undefined, outreach: undefined });
    await waitFor(() => expect(within(list).queryByText(/On this job/)).toBeNull());
  });

  it("adds to a saved job without changing its status", async () => {
    stubApi();
    const patches: EntryPatch[] = [];
    render(<Section start={entry({ status: "applied", contacts: [priya] })} onPatch={(p) => patches.push(p)} />);
    await userEvent.click(await screen.findByText("More"));
    await userEvent.click(screen.getByRole("button", { name: "Add to contacts" }));
    expect("status" in patches[0]!).toBe(false);
    expect(patches[0]!.contacts).toHaveLength(2);
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Added Ada Example to this job");
  });
});

describe("People tab: the one stage control", () => {
  function Tracking({ start }: { start: Entry }) {
    const [e, setE] = useState(start);
    return <JobTracking jobId={job.id} entry={e} title={job.title} initialTab="people" onUpdate={(p) => setE((prev) => applyPatch(prev, job, p) ?? prev)} />;
  }

  it("opens on People and edits each person's stage in one place", async () => {
    render(<Tracking start={entry({ contacts: [priya, { id: "r1", name: "Rex", role: "recruiter" }], outreach: { p1: ask("to-contact") } })} />);
    expect(screen.getByRole("tab", { name: /People/ }).getAttribute("aria-selected")).toBe("true");
    // Priya (asked) has one stage control; Rex, a recruiter not asked, has none.
    expect(screen.getAllByRole("combobox", { name: "Referral" })).toHaveLength(1);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Referral" }), "replied");
    expect((screen.getByRole("combobox", { name: "Referral" }) as HTMLSelectElement).value).toBe("replied");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Via" }), "email");
    expect((screen.getByRole("combobox", { name: "Via" }) as HTMLSelectElement).value).toBe("email");
  });
});
