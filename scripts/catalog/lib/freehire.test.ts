import { describe, expect, it } from "vitest";
import { freehireBoards } from "./freehire";

describe("freehireBoards", () => {
  it("turns each provider's board id into our board", () => {
    expect(
      freehireBoards("workday", [
        { company: "Equifax", board: "equifax.wd5.myworkdayjobs.com/External" },
        { company: "Snap", board: "wd1.myworkdaysite.com/snapchat/snap" },
      ]),
    ).toEqual([
      { ats: "workday", slug: "equifax", shard: "wd5", site: "External", name: "Equifax" },
      { ats: "workday", slug: "snapchat", shard: "wd1", site: "snap", name: "Snap" },
    ]);
    expect(freehireBoards("oracle", [{ company: "ADT", board: "fa-erqb-saasfaprod1.fa.ocs.oraclecloud.com/CX_1" }])).toEqual([
      { ats: "oracle", slug: "fa-erqb-saasfaprod1", shard: "ocs", site: "CX_1", name: "ADT" },
    ]);
    expect(freehireBoards("zohorecruit", [{ company: "Acme", board: "acme.zohorecruit.in" }])).toEqual([{ ats: "zoho", slug: "acme", shard: "in", site: "Careers", name: "Acme" }]);
    expect(freehireBoards("comeet", [{ company: "Overwolf", board: "overwolf/B1.001" }])).toEqual([{ ats: "comeet", slug: "B1.001", site: "overwolf", name: "Overwolf" }]);
    expect(freehireBoards("icims", [{ company: "360care", board: "360care" }])).toEqual([{ ats: "icims", slug: "careers-360care", name: "360care" }]);
  });

  it("keeps Teamtailor sites on companies' own domains (the list names the vendor)", () => {
    expect(
      freehireBoards("teamtailor", [
        { company: "Monta", board: "careers.monta.com" },
        { company: "Beauhurst", board: "beauhurst.teamtailor.com" },
      ]),
    ).toEqual([
      { ats: "teamtailor", slug: "careers.monta.com", name: "Monta" },
      { ats: "teamtailor", slug: "beauhurst", name: "Beauhurst" },
    ]);
  });

  it("skips boards we can't read yet and anything that isn't a plain id", () => {
    expect(freehireBoards("icims", [{ board: "careers.docusign.com" }])).toEqual([]);
    expect(freehireBoards("bamboohr", [{ board: "evil.example/x" }, { board: "" }, { company: "No board" }])).toEqual([]);
    expect(freehireBoards("paycom", [{ board: "abc" }])).toEqual([]);
  });
});
