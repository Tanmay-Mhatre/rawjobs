import { describe, expect, it } from "vitest";
import { planOf, withDefaults } from "../src/lib/prefs";
import {
  type Activity,
  activityAt,
  addActivity,
  applyPatch,
  CAPS,
  capEntry,
  type Entry,
  followUpDue,
  mergeStates,
  normalizeState,
  readStateFile,
  roleFrom,
  toContact,
  type UserState,
} from "../src/lib/userState";

const job = { id: "greenhouse:acme:1", title: "Head of Product", company: "Acme", url: "https://acme.example/1", location: "Dubai", score: 83 };
const snapshot = { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score };
const entry = (o: Partial<Entry> = {}): Entry => ({ status: "applied", updatedAt: "2026-10-10T09:00:00.000Z", snapshot, ...o });
const touch = (o: Partial<Activity> = {}): Activity => ({ id: "a1", at: "2026-10-12T09:00:00.000Z", channel: "email", dir: "sent", ...o });

describe("v1 data read as v2", () => {
  it("gives v1 people a stable id from the job and their place, never from the name", () => {
    const v1 = { [job.id]: entry({ contacts: [{ name: "Priya", role: "Recruiter" } as never, { name: "Sam" } as never] }) };
    const once = normalizeState(v1);
    expect(once[job.id]!.contacts!.map((c) => c.id)).toEqual([`v1:${job.id}:0`, `v1:${job.id}:1`]);
    expect(normalizeState(v1)[job.id]!.contacts).toEqual(once[job.id]!.contacts);
    // Already v2: the same object back, so nothing re-renders or re-saves.
    expect(normalizeState(once)).toBe(once);
  });

  it("maps free-text roles, keeping text that doesn't map as how you met", () => {
    expect(roleFrom("Recruiter")).toEqual({ role: "recruiter" });
    expect(roleFrom("Agency recruiter")).toEqual({ role: "agency" });
    expect(roleFrom("hiring manager")).toEqual({ role: "hiring-manager" });
    // Anything more than the role's own word is kept.
    expect(roleFrom("Senior recruiter, APAC")).toEqual({ role: "recruiter", howMet: "Senior recruiter, APAC" });
    expect(roleFrom("Engineering Manager")).toEqual({ role: "hiring-manager", howMet: "Engineering Manager" });
    expect(roleFrom("Referred me")).toEqual({ role: "referrer", howMet: "Referred me" });
    expect(roleFrom("Panel interviewer")).toEqual({ role: "interviewer", howMet: "Panel interviewer" });
    expect(roleFrom("Friend from uni")).toEqual({ role: "other", howMet: "Friend from uni" });
  });

  it("moves a LinkedIn link to linkedin and keeps link for older versions", () => {
    expect(toContact({ name: "Priya", link: "https://www.linkedin.com/in/priya" }, "x")).toEqual({
      id: "x",
      name: "Priya",
      linkedin: "https://www.linkedin.com/in/priya",
      link: "https://www.linkedin.com/in/priya",
    });
    expect(toContact({ name: "Sam", link: "https://sam.example" }, "x")).toEqual({ id: "x", name: "Sam", link: "https://sam.example" });
    expect(toContact({ name: "Sam", link: "http://linkedin.com/in/sam" }, "x")?.linkedin).toBeUndefined();
    expect(toContact({ name: "Sam", linkedin: "javascript:alert(1)" }, "x")?.linkedin).toBeUndefined();
    expect(toContact({ name: "  " }, "x")).toBeUndefined();
  });

  it("reads anything that isn't an object as empty tracking", () => {
    expect(normalizeState(null)).toEqual({});
    expect(normalizeState([])).toEqual({});
  });
});

describe("keeping entries", () => {
  it("keeps an entry with touches or people when its status is cleared", () => {
    const withTouch = applyPatch(entry({ activities: [touch()] }), job, { status: undefined });
    expect(withTouch?.activities).toHaveLength(1);
    const withPerson = applyPatch(entry({ contacts: [{ id: "p", name: "Priya" }] }), job, { status: undefined });
    expect(withPerson?.contacts).toHaveLength(1);
    expect(applyPatch(entry(), job, { status: undefined })).toBeNull();
  });
});

describe("follow-up dates", () => {
  const at = "2026-10-20T09:00:00.000Z";
  it("are kept in every active stage", () => {
    for (const status of ["saved", "applied", "interviewing", "offer"] as const) {
      expect(applyPatch(entry({ status }), job, { followUp: "2026-10-25" }, at)?.followUp).toBe("2026-10-25");
    }
    expect(applyPatch(entry({ status: "rejected" }), job, { followUp: "2026-10-25" }, at)?.followUp).toBeUndefined();
  });

  it("are cleared by a move unless the patch sets one; applying sets a week out", () => {
    const e = entry({ status: "applied", followUp: "2026-10-25" });
    expect(applyPatch(e, job, { status: "interviewing" }, at)?.followUp).toBeUndefined();
    expect(applyPatch(e, job, { status: "interviewing", followUp: "2026-10-30" }, at)?.followUp).toBe("2026-10-30");
    expect(applyPatch(entry({ status: "saved" }), job, { status: "applied" }, at)?.followUp).toBe("2026-10-27");
  });

  it("are due in any active stage", () => {
    const now = new Date("2026-10-26T12:00:00");
    expect(followUpDue(entry({ status: "interviewing", followUp: "2026-10-25" }), now)).toBe(true);
    expect(followUpDue(entry({ status: "rejected", followUp: "2026-10-25" }), now)).toBe(false);
  });
});

describe("addActivity", () => {
  const now = new Date("2026-10-20T15:00:00");
  it("adds a sent touch and sets the next follow-up from today", () => {
    expect(addActivity(entry(), touch(), { followUpDays: 7 }, now)).toEqual({ activities: [touch()], followUp: "2026-10-27" });
  });
  it("clears the follow-up for a received touch", () => {
    const patch = addActivity(entry({ followUp: "2026-10-22" }), touch({ dir: "received" }), { followUpDays: 7 }, now);
    expect("followUp" in patch && patch.followUp === undefined).toBe(true);
    expect(applyPatch(entry({ followUp: "2026-10-22" }), job, patch)?.followUp).toBeUndefined();
  });
  it("leaves the follow-up alone for a note, or a sent touch without a next date", () => {
    expect("followUp" in addActivity(entry(), touch({ channel: "note", dir: undefined }), { followUpDays: 7 }, now)).toBe(false);
    expect("followUp" in addActivity(entry(), touch(), {}, now)).toBe(false);
  });
  it("stores a past day at noon local and today as now", () => {
    expect(activityAt("2026-10-20", now)).toBe(now.toISOString());
    expect(activityAt("2026-10-18", now)).toBe(new Date("2026-10-18T12:00:00").toISOString());
  });
});

describe("size caps", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("keeps the newest 100 touches, each up to 1,000 characters", () => {
    const many = Array.from({ length: 120 }, (_, i) => touch({ id: `t${i}`, at: new Date(Date.UTC(2026, 8, 1) + i * 3600_000).toISOString(), text: "x".repeat(1500) }));
    const capped = capEntry(entry({ activities: many.reverse() }), now);
    expect(capped.activities).toHaveLength(CAPS.activities);
    expect(capped.activities![0]!.id).toBe("t20");
    expect(capped.activities!.at(-1)!.id).toBe("t119");
    expect(capped.activities![0]!.text).toHaveLength(CAPS.text);
  });
  it("keeps 30 people and the last 50 done tasks, dropping dated ones older than 30 days", () => {
    const people = Array.from({ length: 35 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(capEntry(entry({ contacts: people }), now).contacts).toHaveLength(CAPS.contacts);
    const skipped = ["follow-up:2026-09-01", "close:2", "thank-you:2026-10-15", ...Array.from({ length: 60 }, (_, i) => `x:${i}`)];
    const kept = capEntry(entry({ skipped }), now).skipped!;
    expect(kept).toHaveLength(CAPS.skipped);
    expect(kept).not.toContain("follow-up:2026-09-01");
    expect(capEntry(entry({ skipped: ["close:2", "thank-you:2026-10-15", "follow-up:2026-09-01"] }), now).skipped).toEqual(["close:2", "thank-you:2026-10-15"]);
  });
  it("cuts free text and drops structured values that are too long", () => {
    const c = toContact({ name: "N".repeat(200), email: `${"e".repeat(260)}@x.io`, howMet: "h".repeat(600), phone: "1".repeat(40) }, "x")!;
    expect(c.name).toHaveLength(CAPS.name);
    expect(c.howMet).toHaveLength(CAPS.howMet);
    expect(c.email).toBeUndefined();
    expect(c.phone).toBeUndefined();
  });
});

describe("mergeStates", () => {
  it("joins touches, people and done tasks by id; the newer entry wins the rest", () => {
    const mine: UserState = {
      [job.id]: entry({
        status: "applied",
        updatedAt: "2026-10-10T09:00:00.000Z",
        activities: [touch({ id: "a" })],
        contacts: [{ id: "p", name: "Priya", email: "old@acme.example" }],
        skipped: ["close:0"],
      }),
    };
    const theirs: UserState = {
      [job.id]: entry({
        status: "interviewing",
        updatedAt: "2026-10-12T09:00:00.000Z",
        activities: [touch({ id: "b", at: "2026-10-11T09:00:00.000Z" })],
        contacts: [
          { id: "p", name: "Priya R", email: "new@acme.example" },
          { id: "q", name: "Sam" },
        ],
        skipped: ["follow-up:2026-10-15"],
      }),
    };
    const m = mergeStates(mine, theirs, new Date("2026-10-20T12:00:00Z"))[job.id]!;
    expect(m.status).toBe("interviewing");
    expect(m.activities!.map((a) => a.id)).toEqual(["b", "a"]);
    expect(m.contacts).toEqual([
      { id: "p", name: "Priya R", email: "new@acme.example" },
      { id: "q", name: "Sam" },
    ]);
    expect(m.skipped).toEqual(["close:0", "follow-up:2026-10-15"]);
  });
  it("keeps both people when the same v1 id means different people in the two files", () => {
    const mine: UserState = { [job.id]: entry({ contacts: [{ id: `v1:${job.id}:0`, name: "Priya" }] }) };
    const theirs: UserState = {
      [job.id]: entry({
        updatedAt: "2026-10-12T09:00:00.000Z",
        contacts: [
          { id: `v1:${job.id}:0`, name: "Sam" },
          { id: `v1:${job.id}:1`, name: "Lee" },
        ],
        activities: [touch({ id: "b", contactId: `v1:${job.id}:0` })],
      }),
    };
    const m = mergeStates(mine, theirs, new Date("2026-10-20T12:00:00Z"))[job.id]!;
    expect(m.contacts!.map((c) => c.name)).toEqual(["Priya", "Sam", "Lee"]);
    const sam = m.contacts!.find((c) => c.name === "Sam")!;
    expect(sam.id).not.toBe(`v1:${job.id}:0`);
    // Their touch still points at Sam.
    expect(m.activities![0]!.contactId).toBe(sam.id);
    // The same person under the same v1 id stays one person.
    const same = mergeStates(mine, { [job.id]: entry({ updatedAt: "2026-10-12T09:00:00.000Z", contacts: [{ id: `v1:${job.id}:0`, name: "Priya", email: "p@acme.example" }] }) })[job.id]!;
    expect(same.contacts).toEqual([{ id: `v1:${job.id}:0`, name: "Priya", email: "p@acme.example" }]);
  });

  it("keeps an entry only one side has", () => {
    expect(mergeStates({}, { x: entry() })).toEqual({ x: entry() });
  });
});

describe("import", () => {
  const file = (state: unknown) => new File([JSON.stringify({ app: "rawjobs", version: 2, state })], "export.json");
  const now = new Date("2026-10-20T12:00:00Z");

  it("checks every new field and drops bad items", async () => {
    const { state, skipped } = await readStateFile(
      file({
        [job.id]: {
          status: "interviewing",
          followUp: "2026-10-25",
          updatedAt: "2026-10-15T09:00:00.000Z",
          snapshot,
          contacts: [{ id: "p", name: "Priya", role: "recruiter", email: "priya@acme.example" }, { name: "" }, { name: "Old", role: "Recruiter" }],
          activities: [
            touch({ id: "ok", contactId: "p" }),
            touch({ id: "ghost", contactId: "gone" }),
            { ...touch({ id: "badChannel" }), channel: "fax" },
            { ...touch({ id: "badDir" }), dir: "sideways" },
            touch({ id: "future", at: "2027-01-01T00:00:00.000Z" }),
            touch({ id: "noTime", at: "yesterday" }),
            touch({ id: "note", channel: "note", dir: "sent" }),
          ],
          interviews: [
            { on: "2026-10-22", what: "Final", time: "14:30", contactId: "nobody" },
            { on: "soon", what: "x" },
          ],
          skipped: ["close:1", 3],
        },
        bad: { snapshot: {} },
      }),
      now,
    );
    expect(skipped).toBe(1);
    const e = state[job.id]!;
    expect(e.followUp).toBe("2026-10-25");
    expect(e.contacts!.map((c) => c.id)).toEqual(["p", `v1:${job.id}:2`]);
    expect(e.contacts![1]!.role).toBe("recruiter");
    expect(e.activities!.map((a) => a.id).sort()).toEqual(["ghost", "note", "ok"]);
    expect(e.activities!.find((a) => a.id === "ghost")!.contactId).toBeUndefined();
    expect(e.activities!.find((a) => a.id === "note")!.dir).toBeUndefined();
    expect(e.interviews).toEqual([{ on: "2026-10-22", what: "Final", time: "14:30" }]);
    expect(e.skipped).toEqual(["close:1"]);
  });

  it("keeps a v1 entry with only people, and drops a follow-up date outside the active stages", async () => {
    const { state } = await readStateFile(
      file({
        a: { updatedAt: "2026-10-15T09:00:00.000Z", snapshot, contacts: [{ name: "Priya" }] },
        b: { status: "rejected", followUp: "2026-10-25", updatedAt: "2026-10-15T09:00:00.000Z", snapshot },
      }),
      now,
    );
    expect(state.a!.contacts).toEqual([{ id: "v1:a:0", name: "Priya" }]);
    expect(state.b!.followUp).toBeUndefined();
  });
});

describe("weekly plan", () => {
  it("reads the v1 weeklyGoal as the applications plan, and keeps writing it", () => {
    expect(planOf({ weeklyGoal: 5 })).toEqual({ applications: 5 });
    expect(planOf({ weeklyGoal: 80 })).toEqual({ applications: 50 });
    const p = withDefaults({ weeklyPlan: { applications: 6, followUps: 3, outreach: 0 } });
    expect(p.weeklyPlan).toEqual({ applications: 6, followUps: 3 });
    expect(p.weeklyGoal).toBe(6);
    expect(withDefaults({}).weeklyPlan).toEqual({});
    expect(withDefaults({}).weeklyGoal).toBeUndefined();
  });
});
