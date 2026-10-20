import type { Contact } from "./userState";

/** Every link to a person opens with this, so the page it opens can't reach back into RawJobs. */
export const LINK_REL = "noopener noreferrer";

export type ContactLinks = {
  /** mailto: with the address encoded, so nothing in it can add a subject, body or other recipients. */
  email?: string;
  /** tel: with the number's digits. */
  call?: string;
  /** https://wa.me/<digits>: only for a number with a country code that's switched to WhatsApp. */
  whatsapp?: string;
  /** Their LinkedIn profile: https on linkedin.com only. */
  linkedin?: string;
  /** WhatsApp is on but the number has no country code: the form says "Add the country code to use WhatsApp". */
  needsCountryCode?: boolean;
};

const EMAIL = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/;

/** A LinkedIn profile URL, if it is one: parsed, https, on linkedin.com or a subdomain of it. */
export function linkedInUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && (u.hostname === "linkedin.com" || u.hostname.endsWith(".linkedin.com")) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** A phone number's digits (8 to 15 of them), and whether it starts with + and a country code. */
export function phoneDigits(raw: string | undefined): { digits: string; international: boolean } | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  return { digits, international: raw.trim().startsWith("+") };
}

/**
 * The one place that builds links to a person (People cards, Copy and open), each from a checked
 * value: anything that doesn't pass is left out, never passed through. RawJobs sends nothing: each
 * link opens your own mail, phone, WhatsApp or LinkedIn.
 */
export function contactLinks(c: Pick<Contact, "email" | "phone" | "whatsapp" | "linkedin" | "link">): ContactLinks {
  const out: ContactLinks = {};
  const email = c.email?.trim();
  if (email && EMAIL.test(email)) out.email = `mailto:${encodeURIComponent(email)}`;
  const phone = phoneDigits(c.phone);
  if (phone) {
    // A local number dials as written; with a country code it dials internationally.
    out.call = phone.international ? `tel:+${phone.digits}` : `tel:${phone.digits}`;
    if (c.whatsapp && phone.international) out.whatsapp = `https://wa.me/${phone.digits}`;
    if (c.whatsapp && !phone.international) out.needsCountryCode = true;
  }
  const linkedin = linkedInUrl(c.linkedin ?? c.link);
  if (linkedin) out.linkedin = linkedin;
  return out;
}
