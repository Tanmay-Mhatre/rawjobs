import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { addNames, caEmployers, matchable, matchVisa, nlEmployers, normaliseEmployer, parseCsv, readXlsx, type RegisterFile, ukEmployers, usEmployers } from "./visa";

/** A minimal zip (deflated entries), enough for readXlsx. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, "utf8"));
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const reg = (country: RegisterFile["country"], names: string[], period = "2026-10-13"): RegisterFile => {
  const out: Record<string, string> = {};
  addNames(out, names, period);
  return { country, period, fetched_at: "2026-10-13T00:00:00Z", rows: names.length, names: out };
};

describe("normaliseEmployer", () => {
  it("drops case, punctuation, a leading The and trailing legal forms", () => {
    expect(normaliseEmployer("The Acme Company Ltd")).toEqual(["acme"]);
    expect(normaliseEmployer("ACME, INC.")).toEqual(["acme"]);
    expect(normaliseEmployer("Acme UK Holdings Limited")).toEqual(["acme"]);
    expect(normaliseEmployer("Acme B.V.")).toEqual(["acme"]);
    expect(normaliseEmployer("Acme GmbH")).toEqual(["acme"]);
    expect(normaliseEmployer("Smith & Co LLP")).toEqual(["smith"]);
    expect(normaliseEmployer("Procter & Gamble")).toEqual(["procter and gamble"]);
    expect(normaliseEmployer("Société Générale")).toEqual(["societe generale"]);
    expect(normaliseEmployer("Domino’s Pizza (UK) PLC")).toEqual(["dominos pizza"]);
    // A name that is only a legal form keeps it, rather than becoming empty.
    expect(normaliseEmployer("Limited")).toEqual(["limited"]);
  });
  it("reads a trading name as a second name", () => {
    expect(normaliseEmployer("Widget Holdings Ltd t/a Widgetco")).toEqual(["widget", "widgetco"]);
    expect(normaliseEmployer("ACME CORP DBA ROCKETS INC")).toEqual(["acme", "rockets"]);
  });
  it("can't match short, numeric or stoplisted names", () => {
    expect(matchable("ibm")).toBe(false);
    expect(matchable("12345")).toBe(false);
    expect(matchable("digital")).toBe(false);
    expect(matchable("databricks")).toBe(true);
  });
});

describe("reading the registers", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
  });
  it("UK: work routes only", () => {
    const csv = [
      "Organisation Name,Town/City,County,Type & Rating,Route",
      "Acme Ltd,London,,Worker (A rating),Skilled Worker",
      '"Beta, Gamma Limited",Leeds,,Worker (A rating),Global Business Mobility: Senior or Specialist Worker',
      "St Mary Church,York,,Worker (A rating),Tier 2 Ministers of Religion",
      "FC United,Manchester,,Temporary Worker (A rating),International Sportsperson",
    ].join("\n");
    expect(ukEmployers(csv)).toEqual({ rows: 4, names: ["Acme Ltd", "Beta, Gamma Limited"] });
    expect(() => ukEmployers("Name,Town\nAcme,London")).toThrow(/unexpected columns/);
  });
  it("US: employers with a new or continuing approval, in the year asked for", () => {
    const csv = [
      "Employer (Petitioner) Name,Fiscal Year   ,Industry (NAICS) Code,Measure Names,Petitioner City,Petitioner State,Petitioner Zip Code,Tax ID,Line by line,Measure Values",
      'ACME INC,2026,,New Employment Approval,BOSTON,MA,02210,1133,"1,234",3',
      "ACME INC,2026,,Continuation Approval,BOSTON,MA,02210,1133,1,0",
      "DENIED LLC,2026,,New Employment Approval,AUSTIN,TX,73301,1,1,0",
      "DENIED LLC,2026,,New Employment Denial,AUSTIN,TX,73301,1,1,2",
      'BIG CORP,2026,,Continuation Approval,NY,NY,10001,2,1,"1,200"',
      "OLD CO,2025,,New Employment Approval,NY,NY,10001,3,1,5",
    ].join("\n");
    expect(usEmployers(csv, 2026)).toEqual({ rows: 3, names: ["ACME INC", "BIG CORP"] });
    expect(usEmployers("\n", 2027)).toEqual({ rows: 0, names: [] });
    // The older yearly files: a column per measure.
    const yearly = "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial\n2023,ACME INC,0,1,2,0\n2023,NOPE LLC,0,3,0,1\n";
    expect(usEmployers(yearly).names).toEqual(["ACME INC"]);
  });
  it("Canada: an xlsx quarter, primary agriculture left out", () => {
    const shared = [
      "Title row",
      "Province/Territory",
      "Program Stream",
      "Employer",
      "Ontario",
      "High Wage",
      "Acme Software Inc.",
      "Primary Agriculture",
      "Sunny Farms Ltd",
      "Global Talent",
      "Rocket &amp; Co",
    ];
    const sst = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
    const cell = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
    const sheet = `<worksheet><sheetData>
      <row r="1">${cell("A1", 0)}</row>
      <row r="2">${cell("A2", 1)}${cell("B2", 2)}${cell("C2", 3)}<c r="D2" t="inlineStr"><is><t>Approved LMIAs</t></is></c></row>
      <row r="3">${cell("A3", 4)}${cell("B3", 5)}${cell("C3", 6)}<c r="D3"><v>2</v></c></row>
      <row r="4">${cell("A4", 4)}${cell("B4", 7)}${cell("C4", 8)}<c r="D4"><v>9</v></c></row>
      <row r="5">${cell("A5", 4)}${cell("B5", 9)}${cell("C5", 10)}<c r="D5"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const rows = readXlsx(zip({ "xl/sharedStrings.xml": sst, "xl/worksheets/sheet1.xml": sheet }));
    expect(rows[1]).toEqual(["Province/Territory", "Program Stream", "Employer", "Approved LMIAs"]);
    expect(caEmployers(rows)).toEqual({ rows: 3, names: ["Acme Software Inc.", "Rocket & Co"] });
  });
  it("Netherlands: the IND table and its date", () => {
    const html = `<p>The register was last updated on 5 October 2026.</p><table><thead><tr><th scope="col">Organisation</th><th scope="col">KVK</th></tr></thead><tbody>
      <tr><th scope="row">""Aa-Dee"" Machinefabriek B.V.</th><td>16051874</td></tr><tr><th scope="row">Booking.com B.V.</th><td>31047344</td></tr></tbody></table>`;
    expect(nlEmployers(html)).toEqual({ rows: 2, names: ['"Aa-Dee" Machinefabriek B.V.', "Booking.com B.V."], updated: "2026-10-05" });
    expect(() => nlEmployers("<p>nothing</p>")).toThrow();
  });
  it("keeps the newest period per name", () => {
    const names: Record<string, string> = {};
    addNames(names, ["Acme Inc"], "FY2025");
    addNames(names, ["ACME INC.", "Beta LLC"], "FY2026");
    addNames(names, ["Acme"], "FY2024");
    expect(names).toEqual({ acme: "FY2026", beta: "FY2026" });
  });
});

describe("matchVisa", () => {
  const companies = [
    { key: "greenhouse:databricks", name: "Databricks", open_jobs: 300 },
    { key: "lever:acme", name: "Acme Inc.", open_jobs: 3 },
    // Two directory companies with one name: the register can't say which.
    { key: "lever:nova-labs", name: "Nova Labs", open_jobs: 2 },
    { key: "ashby:novalabs", name: "Nova Labs Ltd", open_jobs: 5 },
    // Too generic, too short.
    { key: "workable:digital", name: "Digital", open_jobs: 50 },
    { key: "lever:ibm", name: "IBM", open_jobs: 900 },
    // A common name: small company skipped, big one kept.
    { key: "workable:passion", name: "Passion", open_jobs: 4 },
    { key: "workday:stripe", name: "Stripe", open_jobs: 700 },
    { key: "lever:nobody", name: "Nobody Here", open_jobs: 1 },
  ];
  const gb = reg("GB", [
    "Databricks UK Ltd",
    "ACME LIMITED",
    "Nova Labs Limited",
    "Digital Ltd",
    "IBM United Kingdom Ltd",
    "Passion Ltd",
    "Passion Foods Ltd",
    "Passion Care Ltd",
    "Passion Events Ltd",
    "Stripe Payments UK Ltd",
    "Stripe Ltd",
    "Stripe Media Ltd",
    "Stripe Design Ltd",
    "Stripe Partners Ltd",
  ]);
  const us = reg("US", ["DATABRICKS INC"], "FY2026");

  it("tags companies on a register, per country", () => {
    const { visa, stats } = matchVisa(companies, [gb, us]);
    expect(Object.fromEntries(visa)).toEqual({
      "greenhouse:databricks": { GB: "2026-10-13", US: "FY2026" },
      "lever:acme": { GB: "2026-10-13" },
      "workday:stripe": { GB: "2026-10-13" },
    });
    expect(stats[0]).toMatchObject({ country: "GB", matched: 3, skippedAmbiguous: 1, skippedCommon: 1 });
    expect(stats[1]).toMatchObject({ country: "US", matched: 1 });
  });
  it("never matches a name used by 10 or more register employers", () => {
    const many = reg("GB", ["Stripe Ltd", ...Array.from({ length: 10 }, (_, i) => `Stripe Thing${i} Ltd`)]);
    expect(matchVisa(companies, [many]).visa.has("workday:stripe")).toBe(false);
  });
});
