// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/Toast", () => ({ toast: vi.fn() }));
vi.mock("../src/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));
import { MessageDrafts } from "../src/components/referral/MessageDrafts";
import { TalkToSomeone } from "../src/components/referral/TalkToSomeone";
import { toast } from "../src/components/Toast";
import { copyText } from "../src/lib/clipboard";
import { type NetworkPersonRow, resetNetworkStore } from "../src/lib/network";
import { aiPrompt, draftTemplates, jobIdOf } from "../src/lib/referralDrafts";
import { applyPatch, type Entry, type EntryPatch } from "../src/lib/userState";
import { makeJob } from "./helpers";

const job = makeJob({ id: "greenhouse:acme:4012345", company: "Acme", title: "Senior Product Manager", url: "https://boards.greenhouse.io/acme/jobs/4012345" });
const inputs = { job, company: "Acme", first: "Ada", position: "Engineering Manager" };

beforeEach(() => {
  resetNetworkStore();
  vi.mocked(toast).mockClear();
  vi.mocked(copyText).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("message templates", () => {
  it("fills in the job, the company, the person and the job ID", () => {
    const d = draftTemplates(inputs);
    expect(d.note).toBe("Hi Ada, I'm applying for the Senior Product Manager role at Acme and would love to hear what it's like on your team. Open to a quick chat?");
    expect(d.ask).toBe(
      "Hi Ada, I'm applying for Senior Product Manager at Acme (https://boards.greenhouse.io/acme/jobs/4012345, job ID 4012345). Would you be open to referring me? I can send my resume and a short note you can forward. Thanks either way.",
    );
    expect(d.follow).toBe("Hi Ada, following up on my note about the Senior Product Manager role at Acme. Happy to share more if it helps. Thanks for your time.");
    expect(draftTemplates({ ...inputs, background: "payments" }).ask).toContain("). My background in payments fits what the team needs. Would you");
  });

  it("drops what isn't known: the name, the link, the job ID", () => {
    const d = draftTemplates({ job: { id: "manual:x", title: "Analyst" }, company: "Acme" });
    expect(d.note.startsWith("Hi, I'm applying for the Analyst role at Acme")).toBe(true);
    expect(d.ask.startsWith("Hi, I'm applying for Analyst at Acme. Would you")).toBe(true);
  });

  it("reads the job ID from the id first, then from the link", () => {
    expect(jobIdOf({ id: "workday:acme|external:R-12345" })).toBe("R-12345");
    expect(jobIdOf({ id: "lever:acme:1a2b-3c4d" })).toBe("1a2b-3c4d");
    expect(jobIdOf({ id: "added:abc", url: "https://acme.example/careers?gh_jid=778899" })).toBe("778899");
    expect(jobIdOf({ id: "added:abc", url: "https://acme.example/jobs/55123" })).toBe("55123");
    expect(jobIdOf({ id: "added:abc", url: "https://acme.example/jobs/product-manager" })).toBeUndefined();
    expect(jobIdOf({ id: "added:abc", url: "not a link" })).toBeUndefined();
  });

  it("writes a prompt with the rules, the job and their position, never your resume", () => {
    const p = aiPrompt("note", inputs);
    expect(p).toContain("(under 200 characters) from me to Ada (Engineering Manager) at Acme.");
    expect(p).toContain("I'm applying for Senior Product Manager (https://boards.greenhouse.io/acme/jobs/4012345).");
    expect(p).toContain("No flattery");
    expect(p).toContain("Never offer payment");
    expect(p).not.toMatch(/resume|résumé/i);
    expect(aiPrompt("ask", inputs)).toContain("referring me");
  });
});

const openDrafts = (onMessaged?: (t: string) => void) => render(<MessageDrafts name="Ada Example" inputs={inputs} onClose={() => {}} onMessaged={onMessaged} />);
const box = () => screen.getByLabelText("Your message") as HTMLTextAreaElement;
const type = (n: number) => fireEvent.change(box(), { target: { value: "x".repeat(n) } });

describe("message drafts dialog", () => {
  it("counts the connection note, warns past 180 and 200, and announces only when crossing", () => {
    openDrafts();
    const ids = box().getAttribute("aria-describedby")!.split(" ");
    const [counter, live] = ids.map((id) => document.getElementById(id)!);
    expect(counter!.getAttribute("aria-live")).toBeNull();
    expect(live!.getAttribute("aria-live")).toBe("polite");

    type(180);
    expect(counter!.textContent).toBe("180 / 200");
    expect(counter!.className).toContain("text-muted");
    expect(live!.textContent).toBe("");
    type(181);
    expect(counter!.textContent).toBe("181 / 200· Close to LinkedIn's limit");
    expect(counter!.className).toContain("text-warning-text");
    expect(live!.textContent).toBe("Close to LinkedIn's 200-character limit.");
    type(200);
    expect(counter!.className).toContain("text-warning-text");
    type(212);
    expect(counter!.textContent).toBe("212 / 200· 12 over LinkedIn's limit");
    expect(counter!.className).toContain("text-danger-text");
    expect(live!.textContent).toBe("Over LinkedIn's 200-character limit.");
    type(205);
    expect(live!.textContent).toBe("Over LinkedIn's 200-character limit.");
    type(20);
    expect(live!.textContent).toBe("");
  });

  it("keeps each tab's edits when you switch tabs", async () => {
    openDrafts();
    fireEvent.change(box(), { target: { value: "My own note" } });
    await userEvent.click(screen.getByRole("tab", { name: "Ask for a referral" }));
    expect(box().value).toContain("Would you be open to referring me?");
    expect(box().getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(box(), { target: { value: "My own ask" } });
    await userEvent.click(screen.getByRole("tab", { name: "Connection note" }));
    expect(box().value).toBe("My own note");
    await userEvent.click(screen.getByRole("tab", { name: "Ask for a referral" }));
    expect(box().value).toBe("My own ask");
  });

  it("copies the draft and the AI prompt, with feedback inline", async () => {
    openDrafts(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(vi.mocked(copyText)).toHaveBeenLastCalledWith(draftTemplates(inputs).note);
    expect(screen.getByRole("status").textContent).toBe("Copied. Paste it into LinkedIn and send it from there.");
    await userEvent.click(screen.getByRole("button", { name: "Copy a prompt for your own AI" }));
    expect(vi.mocked(copyText)).toHaveBeenLastCalledWith(aiPrompt("note", inputs));
    vi.mocked(copyText).mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("status").textContent).toBe("Couldn't copy. Select the text and press Ctrl+C.");
  });
});

const ada: NetworkPersonRow = { id: "u:ada", first: "Ada", last: "Example", friend: false, company: "Acme", position: "Engineering Manager", url: "https://www.linkedin.com/in/ada" };
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

function Section({ start, onPatch }: { start?: Entry; onPatch: (p: EntryPatch) => void }) {
  const [e, setE] = useState<Entry | undefined>(start);
  return (
    <TalkToSomeone
      job={job}
      entry={e}
      onUpdate={(p) => {
        onPatch(p);
        setE((prev) => applyPatch(prev, job, p) ?? undefined);
      }}
    />
  );
}

const openFromRow = async () => {
  await userEvent.click(await screen.findByText("More"));
  await userEvent.click(screen.getByRole("button", { name: "Draft a message" }));
  return screen.getByRole("dialog", { name: "Message Ada Example" });
};

describe("Draft a message from the referral section", () => {
  it("copies, marks as messaged (adding the person and saving the job), and Undo puts it back", async () => {
    stubApi();
    const patches: EntryPatch[] = [];
    render(<Section onPatch={(p) => patches.push(p)} />);
    const dialog = await openFromRow();
    await userEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as messaged" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const p = patches[0]!;
    expect(p).toMatchObject({ status: "saved", contacts: [{ name: "Ada Example", role: "referrer", linkedin: "https://www.linkedin.com/in/ada" }] });
    const cid = p.contacts![0]!.id;
    expect(p.outreach![cid]).toMatchObject({ stage: "messaged", via: "linkedin", networkId: "u:ada" });
    expect(p.activities).toEqual([expect.objectContaining({ channel: "linkedin", dir: "sent", contactId: cid, text: draftTemplates(inputs).note })]);
    expect(await screen.findByText("On this job: Messaged")).toBeTruthy();

    const t = vi.mocked(toast).mock.calls[0]![0];
    expect(t.message).toBe("Saved this job and marked Ada Example as messaged");
    t.onAction!();
    expect(patches[1]).toEqual({ status: undefined, contacts: undefined, outreach: undefined, activities: undefined });
  });

  it("marks someone already on the job without copying, keeping them once", async () => {
    stubApi();
    const patches: EntryPatch[] = [];
    const contact = { id: "c1", name: "Ada Example", role: "referrer" as const, company: "Acme", linkedin: "https://www.linkedin.com/in/ada" };
    const start: Entry = {
      status: "applied",
      updatedAt: "2026-10-10T09:00:00.000Z",
      snapshot: { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score },
      contacts: [contact],
      outreach: { c1: { stage: "to-contact", via: "linkedin", at: "2026-10-12T09:00:00.000Z", networkId: "u:ada" } },
    };
    render(<Section start={start} onPatch={(p) => patches.push(p)} />);
    const dialog = await openFromRow();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as messaged" }));
    expect(vi.mocked(copyText)).not.toHaveBeenCalled();
    expect("status" in patches[0]!).toBe(false);
    expect("contacts" in patches[0]!).toBe(false);
    expect(patches[0]!.outreach!.c1).toMatchObject({ stage: "messaged" });
    expect(vi.mocked(toast).mock.calls[0]![0].message).toBe("Marked Ada Example as messaged");
  });

  it("Esc closes the drafts only, never the job panel behind them", async () => {
    stubApi();
    const closeJob = vi.fn();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeJob();
    window.addEventListener("keydown", onKey);
    try {
      render(<Section onPatch={() => {}} />);
      await openFromRow();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(closeJob).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });
});
