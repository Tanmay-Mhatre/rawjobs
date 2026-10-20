import { describe, expect, it } from "vitest";
import { contactLinks, linkedInUrl, phoneDigits } from "../src/lib/contactLinks";

describe("contactLinks", () => {
  it("builds every link from checked values", () => {
    expect(contactLinks({ email: "priya@acme.example", phone: "+971 50 123 4567", whatsapp: true, linkedin: "https://www.linkedin.com/in/priya" })).toEqual({
      email: "mailto:priya@acme.example",
      call: "tel:+971501234567",
      whatsapp: "https://wa.me/971501234567",
      linkedin: "https://www.linkedin.com/in/priya",
    });
    expect(contactLinks({})).toEqual({});
  });

  it("never passes through a javascript: or other non-LinkedIn link", () => {
    expect(contactLinks({ linkedin: "javascript:alert(1)" }).linkedin).toBeUndefined();
    expect(contactLinks({ link: "javascript:alert(1)" }).linkedin).toBeUndefined();
    expect(linkedInUrl("http://linkedin.com/in/x")).toBeUndefined();
    expect(linkedInUrl("https://linkedin.com.evil.example/in/x")).toBeUndefined();
    expect(linkedInUrl("https://evil.example/?https://linkedin.com")).toBeUndefined();
    expect(linkedInUrl("https://uk.linkedin.com/in/x")).toBe("https://uk.linkedin.com/in/x");
    // A v1 link on LinkedIn still works.
    expect(contactLinks({ link: "https://www.linkedin.com/in/sam" }).linkedin).toBe("https://www.linkedin.com/in/sam");
  });

  it("refuses an email that could add recipients, a subject or a body", () => {
    for (const email of ["a@b.co?cc=x@y.co", "a@b.co&body=hi", "a@b.co#x", "a b@c.co", "not-an-email", "a@b"]) {
      expect(contactLinks({ email }).email, email).toBeUndefined();
    }
    expect(contactLinks({ email: " a.b+jobs@c.co " }).email).toBe("mailto:a.b%2Bjobs@c.co");
    // Whatever passes is encoded inside a mailto: link, never a link of its own.
    expect(contactLinks({ email: "javascript:alert(1)//@x.co" }).email).toBe("mailto:javascript%3Aalert(1)%2F%2F@x.co");
  });

  it("keeps local numbers off WhatsApp and asks for the country code", () => {
    expect(contactLinks({ phone: "050 123 4567", whatsapp: true })).toEqual({ call: "tel:0501234567", needsCountryCode: true });
    expect(contactLinks({ phone: "050 123 4567" })).toEqual({ call: "tel:0501234567" });
    expect(contactLinks({ phone: "+971 50 123 4567" }).whatsapp).toBeUndefined();
  });

  it("accepts 8 to 15 digits only", () => {
    expect(phoneDigits("1234567")).toBeUndefined();
    expect(phoneDigits("+1234567890123456")).toBeUndefined();
    expect(phoneDigits("+44 (20) 7946-0958")).toEqual({ digits: "442079460958", international: true });
  });
});
