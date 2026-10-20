import { describe, expect, it } from "vitest";
import { PASTE_CAPS, parsePeoplePaste } from "../src/network/paste";

// Synthetic people, laid out the way a copied LinkedIn people search reads.
const page = `Skip to main content
Home
My Network
Jobs
Messaging
Notifications
Connections
1st
2nd
3rd+
Locations
Current company
All filters
Reset
About 1,234 results
Ada Testperson
View Ada Testperson’s profile
 • 1st
1st degree connection
Senior Product Manager at Acme
London, England, United Kingdom
Current: Senior Product Manager at Acme
Message
Ben Sample
Ben Sample
View Ben Sample's profile
Status is reachable
 • 2nd
2nd degree connection
Software Engineer
Berlin, Germany
Cara Quote and 12 other mutual connections
Connect
Dan Distant
View Dan Distant’s profile
 • 3rd+
Designer
Paris
Connect
Eve Inline • 2nd
Recruiter at Acme
Remote
Fay Friend is a mutual connection
Connect
LinkedIn Member
 • 2nd
Product Lead
Connect
Gus Two • 2nd
Data Scientist
Gus Two • 2nd
Data Scientist
Hal Pair
 • 2nd
Engineering Manager
Hal Pair and Ida Mutual are mutual connections
Are these results helpful?
Next`;

describe("parsePeoplePaste", () => {
  const { people, noEnglishMarkers } = parsePeoplePaste(page);

  it("keeps 1st and 2nd connections only, in order", () => {
    expect(people.map((p) => [p.name, p.degree])).toEqual([
      ["Ada Testperson", 1],
      ["Ben Sample", 2],
      ["Eve Inline", 2],
      ["Gus Two", 2],
      ["Hal Pair", 2],
    ]);
    expect(noEnglishMarkers).toBe(false);
  });

  it("reads title and place after the marker, skipping buttons and status lines", () => {
    expect(people[0]).toEqual({ name: "Ada Testperson", degree: 1, title: "Senior Product Manager at Acme", location: "London, England, United Kingdom" });
    expect(people[1]).toMatchObject({ title: "Software Engineer", location: "Berlin, Germany" });
    expect(people[2]).toMatchObject({ title: "Recruiter at Acme", location: "Remote" });
  });

  it("reads mutual connections in each form", () => {
    expect(people[1]!.mutual).toEqual({ first: "Cara Quote", others: 12 });
    expect(people[2]!.mutual).toEqual({ first: "Fay Friend", others: 0 });
    expect(people[4]!.mutual).toEqual({ first: "Hal Pair", others: 1 });
    expect(people[0]!.mutual).toBeUndefined();
  });

  it("dedupes repeated results", () => {
    expect(people.filter((p) => p.name === "Gus Two")).toHaveLength(1);
  });

  it("uses the View profile line as the name, with either apostrophe", () => {
    const a = parsePeoplePaste("Someone\nView Jo Example’s profile\n• 2nd\nPM");
    expect(a.people[0]!.name).toBe("Jo Example");
    const b = parsePeoplePaste("View Jo Example's profile\nJo Example\n• 1st\nPM\nLondon");
    expect(b.people).toEqual([{ name: "Jo Example", degree: 1, title: "PM", location: "London" }]);
  });

  it("reads the one-line and two-line forms, with 3rd+ spaced", () => {
    expect(parsePeoplePaste("Kim Lee • 1st\nAnalyst").people).toEqual([{ name: "Kim Lee", degree: 1, title: "Analyst" }]);
    expect(parsePeoplePaste("Kim Lee\n• 2nd\nAnalyst").people).toEqual([{ name: "Kim Lee", degree: 2, title: "Analyst" }]);
    expect(parsePeoplePaste("Kim Lee • 3rd+\nAnalyst").people).toEqual([]);
    expect(parsePeoplePaste("Kim Lee\n · 3rd+\nAnalyst").people).toEqual([]);
    expect(parsePeoplePaste("Kim Lee\n2nd degree connection\nAnalyst").people).toEqual([{ name: "Kim Lee", degree: 2, title: "Analyst" }]);
  });

  it("doesn't take the next person's name as a place", () => {
    const { people: p } = parsePeoplePaste("Ann One\n• 2nd\nEngineer\nBob Two\n• 2nd\nDesigner\nOslo");
    expect(p).toEqual([
      { name: "Ann One", degree: 2, title: "Engineer" },
      { name: "Bob Two", degree: 2, title: "Designer", location: "Oslo" },
    ]);
  });

  it("finds no one in navigation alone or empty input", () => {
    expect(parsePeoplePaste("Home\nConnections\n1st\n2nd\n3rd+\nLocations").people).toEqual([]);
    expect(parsePeoplePaste("")).toEqual({ people: [], noEnglishMarkers: false });
  });

  it("flags a paste with no English markers", () => {
    const fr = parsePeoplePaste("Ana Exemple\n• 2e\nVoir le profil de Ana Exemple\nIngénieure");
    expect(fr).toEqual({ people: [], noEnglishMarkers: true });
    expect(parsePeoplePaste("   \n  ").noEnglishMarkers).toBe(false);
  });

  it("caps people, line length and input size", () => {
    const many = Array.from({ length: 150 }, (_, i) => `Person ${String.fromCharCode(65 + (i % 26))}${i} • 2nd\nRole ${i}`).join("\n");
    expect(parsePeoplePaste(many).people).toHaveLength(PASTE_CAPS.people);
    const long = parsePeoplePaste(`Lou Long • 1st\n${"t".repeat(1000)}`).people[0]!;
    expect(long.title!.length).toBeLessThanOrEqual(PASTE_CAPS.line);
    const huge = parsePeoplePaste(`${"x\n".repeat(PASTE_CAPS.chars / 2)}Zed Late • 1st\nRole`);
    expect(huge.people).toEqual([]);
  });
});
