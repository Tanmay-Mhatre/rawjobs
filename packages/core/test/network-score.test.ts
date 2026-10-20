import { describe, expect, it } from "vitest";
import { bandOf, scorePerson } from "../src/network/score";

const now = new Date("2026-10-20T12:00:00Z");
const job = { title: "Senior Product Manager", seniority: "senior" as const };
const me = {
  positions: [
    { company: "Globex", from: "2021-03" },
    { company: "Initech", from: "2017-01", to: "2021-02" },
  ],
};
const ids = (s: ReturnType<typeof scorePerson>) => s.points.map((p) => p.id);

describe("scorePerson", () => {
  it.each([
    ["first", { degree: 1 as const }, 40],
    ["friend", { degree: 2 as const, friend: true }, 20],
    ["colleague", { degree: 2 as const, connectedOn: "2025-06-01" }, 15],
    ["function", { degree: 2 as const, position: "Product Manager" }, 15],
    ["seniority", { degree: 2 as const, position: "Director of Engineering" }, 10],
    ["recruiter", { degree: 2 as const, position: "Talent Acquisition Partner" }, 10],
    ["years", { degree: 2 as const, connectedOn: "2016-10-20" }, 5],
  ])("gives %s points", (id, p, points) => {
    const s = scorePerson(p, job, me, now);
    expect(s.points.find((x) => x.id === id)?.points).toBe(points);
  });

  it("explains each point", () => {
    const s = scorePerson({ degree: 1, friend: true, position: "Senior Product Manager", connectedOn: "2019-05-01" }, job, me, now);
    expect(ids(s)).toEqual(["first", "friend", "colleague", "function", "seniority", "years"]);
    expect(s.points.find((x) => x.id === "colleague")!.text).toBe("You connected while you were at Initech: likely a past colleague");
    expect(s.points.find((x) => x.id === "function")!.text).toBe("Works in Product Management, like this job");
    expect(s.points.find((x) => x.id === "years")!.text).toBe("Connected for 7 years");
    expect(s.total).toBe(105);
    expect(s.band).toBe("high");
    expect(s.why).toBe("You're connected on LinkedIn. You marked them as a close contact");
  });

  it("gives no points without evidence", () => {
    const s = scorePerson({ degree: 2 }, job, me, now);
    expect(s).toEqual({ total: 0, band: "low", points: [], why: "" });
  });

  it("doesn't count a different function, a lower level, or under two years", () => {
    const s = scorePerson({ degree: 2, position: "Junior Accountant", connectedOn: "2025-01-01" }, job, { positions: [] }, now);
    expect(ids(s)).toEqual([]);
    expect(scorePerson({ degree: 2, connectedOn: "2024-10-21" }, job, me, now).points.map((p) => p.id)).toEqual(["colleague"]);
  });

  it("counts the current job up to now and needs a start date", () => {
    expect(ids(scorePerson({ degree: 2, connectedOn: "2026-10-01" }, job, me, now))).toEqual(["colleague"]);
    expect(ids(scorePerson({ degree: 2, connectedOn: "2015-01-01" }, job, me, now))).toEqual(["years"]);
    expect(ids(scorePerson({ degree: 2, connectedOn: "2025-01-01" }, job, { positions: [{ company: "Nowhen" }] }, now))).toEqual([]);
  });

  it("lands on the band edges", () => {
    // friend + colleague = 35, the lowest medium.
    expect(scorePerson({ degree: 2, friend: true, connectedOn: "2025-06-01" }, job, me, now)).toMatchObject({ total: 35, band: "medium" });
    // first + friend = 60, the lowest high.
    expect(scorePerson({ degree: 1, friend: true }, job, me, now)).toMatchObject({ total: 60, band: "high" });
  });

  it.each([
    [0, "low"],
    [34, "low"],
    [35, "medium"],
    [59, "medium"],
    [60, "high"],
    [125, "high"],
  ])("bands %i as %s", (total, band) => {
    expect(bandOf(total)).toBe(band);
  });
});
