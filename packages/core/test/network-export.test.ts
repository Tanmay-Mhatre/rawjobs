import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findHeader, parseCsv } from "../src/network/csv";
import { buildNetwork, CAPS, parseConnections, parseEducation, parseExportDate, parsePositions, profileUrl } from "../src/network/linkedin-export";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/linkedin/${name}`, import.meta.url), "utf8");
/** The way LinkedIn writes them: a BOM and CRLF line ends. */
const asLinkedIn = (s: string) => `\uFEFF${s.replace(/\n/g, "\r\n")}`;
const now = new Date("2026-10-20T12:00:00Z");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and line breaks inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n1,2,3,4')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("handles a BOM, CRLF, a trailing newline and empty fields", () => {
    expect(parseCsv("\uFEFFx,y\r\n,\r\n")).toEqual([
      ["x", "y"],
      ["", ""],
    ]);
  });

  it("clips long fields and stops at the row cap", () => {
    expect(parseCsv(`${"z".repeat(500)},b`, { maxField: 200 })[0]![0]).toHaveLength(200);
    expect(parseCsv("1\n2\n3\n4", { maxRows: 2 })).toEqual([["1"], ["2"]]);
    // An unclosed quote can't grow without end.
    expect(parseCsv(`"${"q".repeat(10_000)}`, { maxField: 200 })[0]![0]).toHaveLength(200);
  });

  it("finds the header after a preamble", () => {
    const rows = parseCsv(asLinkedIn(fixture("Connections.csv")));
    const h = findHeader(rows, ["first name", "URL"]);
    expect(h?.index).toBe(3);
    expect(h?.col("connected on")).toBe(6);
    expect(findHeader(rows, ["nope"])).toBeNull();
  });
});

describe("parseExportDate", () => {
  it.each([
    ["15 Oct 2024", { y: 2024, m: 10, d: 15 }],
    ["03 Jan 2019", { y: 2019, m: 1, d: 3 }],
    ["Oct 15, 2024", { y: 2024, m: 10, d: 15 }],
    ["Oct 2024", { y: 2024, m: 10 }],
    ["October 2024", { y: 2024, m: 10 }],
    ["2024", { y: 2024 }],
    ["10/15/24", { y: 2024, m: 10, d: 15 }],
    ["10/15/2024", { y: 2024, m: 10, d: 15 }],
    ["2024-10-15", { y: 2024, m: 10, d: 15 }],
    ["2024-10-15T08:00:00Z", { y: 2024, m: 10, d: 15 }],
    ["2024-10", { y: 2024, m: 10 }],
  ])("reads %s", (raw, want) => {
    expect(parseExportDate(raw)).toEqual({ m: undefined, d: undefined, ...want });
  });

  it.each(["", "soon", "13/40/24", "32 Foo 2024", "1800"])("rejects %j", (raw) => {
    expect(parseExportDate(raw)).toBeNull();
  });
});

describe("profileUrl", () => {
  it("keeps only LinkedIn /in/ profiles, rewritten to one form", () => {
    expect(profileUrl("https://www.linkedin.com/in/ada-testperson-1a2b3c")?.url).toBe("https://www.linkedin.com/in/ada-testperson-1a2b3c");
    expect(profileUrl("http://uk.linkedin.com/in/x/")?.url).toBe("https://www.linkedin.com/in/x");
    for (const bad of [
      "https://evil.example/in/eve",
      "https://linkedin.com.evil.example/in/x",
      "https://www.linkedin.com/company/acme",
      "javascript:alert(1)",
      "",
      "https://www.linkedin.com/in/x/detail",
    ])
      expect(profileUrl(bad)).toBeNull();
  });
});

describe("parseConnections", () => {
  const people = parseConnections(asLinkedIn(fixture("Connections.csv")))!;

  it("reads the rows after the preamble, dropping blank and LinkedIn Member rows", () => {
    expect(people.map((p) => p.first)).toEqual(["Ada", "Ben", "Cara", "Dev", "Eve"]);
  });

  it("reads quoted commas, quotes and line breaks", () => {
    expect(people[0]).toEqual({
      id: "u:ada-testperson-1a2b3c",
      first: "Ada",
      last: "Testperson",
      url: "https://www.linkedin.com/in/ada-testperson-1a2b3c",
      company: "Acme, Inc.",
      position: "Senior Product Manager",
      connectedOn: "2024-10-15",
    });
    expect(people[2]!.last).toBe('Quote "CQ" Example');
    expect(people[4]!.company).toBe("Stealth Startup");
  });

  it("never keeps the Email column", () => {
    const json = JSON.stringify(people);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("@example.invalid");
  });

  it("drops non-LinkedIn URLs and gives people without one a hashed id", () => {
    expect(people[3]!.url).toBeUndefined();
    expect(people[3]!.id).toMatch(/^n:[0-9a-f]{12}$/);
    expect(people[4]!.url).toBeUndefined();
    expect(people[4]!.id).toMatch(/^n:[0-9a-f]{12}$/);
    // Stable across imports.
    expect(parseConnections(fixture("Connections.csv"))!.map((p) => p.id)).toEqual(people.map((p) => p.id));
  });

  it("reads dates in other formats", () => {
    expect(people.map((p) => p.connectedOn)).toEqual(["2024-10-15", "2019-01-03", "2024-10-15", "2023-06-01", undefined]);
  });

  it("drops duplicate profiles", () => {
    const csv = "First Name,Last Name,URL\nA,B,https://www.linkedin.com/in/same\nA,B,https://www.linkedin.com/in/same/\n";
    expect(parseConnections(csv)).toHaveLength(1);
  });

  it("is null without the header and caps rows and fields", () => {
    expect(parseConnections("Name,Link\nA,B\n")).toBeNull();
    const many = `First Name,Last Name,URL,Position\n${Array.from({ length: CAPS.rows + 10 }, (_, i) => `P${i},L,,${"t".repeat(300)}`).join("\n")}`;
    const out = parseConnections(many)!;
    expect(out).toHaveLength(CAPS.rows);
    expect(out[0]!.position).toHaveLength(160);
  });
});

describe("parsePositions and parseEducation", () => {
  it("reads your jobs, dropping Description and Location", () => {
    const positions = parsePositions(asLinkedIn(fixture("Positions.csv")));
    expect(positions).toEqual([
      { company: "Globex", title: "Product Manager", from: "2021-03" },
      { company: "Initech", title: "Associate Product Manager", from: "2017-01", to: "2021-02" },
    ]);
    expect(JSON.stringify(positions)).not.toMatch(/roadmap|London|Private/);
  });

  it("reads your schools, dropping Notes and Activities", () => {
    const schools = parseEducation(asLinkedIn(fixture("Education.csv")));
    expect(schools).toEqual([{ name: "Example University", from: "2012", to: "2016", degree: "BSc Computer Science" }]);
    expect(JSON.stringify(schools)).not.toMatch(/Private|Chess/);
  });
});

describe("buildNetwork", () => {
  const files = { connections: asLinkedIn(fixture("Connections.csv")), positions: fixture("Positions.csv"), education: fixture("Education.csv") };

  it("builds a network file, keeping friends that still exist", () => {
    const out = buildNetwork(files, { source: "file", fileName: "C:\\Users\\x\\Downloads\\Basic_LinkedInDataExport_10-20-2026.zip", now, keepFriends: ["u:ben-sample", "u:gone", "u:ben-sample"] });
    if ("error" in out) throw new Error(out.error);
    expect(out).toMatchObject({ app: "rawjobs", kind: "network", version: 1, importedAt: now.toISOString(), source: "file", fileName: "Basic_LinkedInDataExport_10-20-2026.zip" });
    expect(out.connections).toHaveLength(5);
    expect(out.positions).toHaveLength(2);
    expect(out.education).toHaveLength(1);
    expect(out.friends).toEqual(["u:ben-sample"]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("needs Connections", () => {
    expect(buildNetwork({ positions: files.positions }, { source: "file", now })).toEqual({ error: "NO_CONNECTIONS" });
    expect(buildNetwork({ connections: "First Name,URL\n" }, { source: "file", now })).toEqual({ error: "NO_CONNECTIONS" });
    expect(buildNetwork({ connections: "not a csv" }, { source: "file", now })).toEqual({ error: "NO_CONNECTIONS" });
  });

  it("refuses a CSV over 10 MB", () => {
    expect(buildNetwork({ connections: `First Name,URL\n${"x".repeat(CAPS.csvChars)}` }, { source: "file", now })).toEqual({ error: "TOO_BIG" });
  });
});
