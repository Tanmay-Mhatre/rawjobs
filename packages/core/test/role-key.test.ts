import { describe, expect, it } from "vitest";
import { roleKey } from "../src/dashboard";
import { companyIdentities } from "../src/store";

describe("roleKey: near-identical titles", () => {
  it("drops gender tags, requisition ids and places; writes out short forms and &", () => {
    const k = roleKey("Senior Software Engineer");
    expect(roleKey("Sr. Software Engineer (m/w/d)")).toBe(k);
    expect(roleKey("Senior Software Engineer (f/m/d)")).toBe(k);
    expect(roleKey("Senior Software Engineer (all genders)")).toBe(k);
    expect(roleKey("Senior Software Engineer (H/F)")).toBe(k);
    expect(roleKey("Senior Software Engineer - R12345")).toBe(k);
    expect(roleKey("Senior Software Engineer (Req #1234)")).toBe(k);
    expect(roleKey("Senior Software Engineer - 123456")).toBe(k);
    expect(roleKey("Senior Software Engineer - Manchester, United Kingdom")).toBe(k);
    expect(roleKey("Research & Development Lead")).toBe(roleKey("Research and Development Lead"));
  });

  it("never fuzzy: different roles stay apart", () => {
    expect(roleKey("Senior Engineer, Payments")).not.toBe(roleKey("Senior Engineer, Platform"));
    expect(roleKey("Engineer II")).not.toBe(roleKey("Engineer III"));
  });
});

describe("companyIdentities (directory same_as and accepted moves)", () => {
  it("maps joined boards to their shared key, and a moved board to its new one", () => {
    const ids = companyIdentities(
      [
        { key: "ashby:doctolib", ats: "ashby", slug: "doctolib", same_as: "greenhouse:doctolib" },
        { key: "greenhouse:doctolib", ats: "greenhouse", slug: "doctolib", same_as: "greenhouse:doctolib" },
        { key: "lever:linear", ats: "lever", slug: "linear" },
      ],
      [{ from: { ats: "lever", slug: "doctolib-old" }, to: { ats: "ashby", slug: "doctolib" } }],
    );
    expect(ids.get("ashby:doctolib")).toBe("greenhouse:doctolib");
    expect(ids.get("lever:doctolib-old")).toBe("greenhouse:doctolib");
    expect(ids.has("lever:linear")).toBe(false);
  });
});
