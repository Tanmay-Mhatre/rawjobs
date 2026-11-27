/**
 * Take out of a diagnostics file what would say who you are or what you're looking for (PRIVACY.md):
 * your folders and user name, your computer's name, tokens and keys, chat ids, emails, phone numbers,
 * LinkedIn profiles, IP addresses, query strings, and the companies in your config. `counts` says how
 * many of each were taken out, so whoever reads the file knows what's missing.
 */
export type RedactContext = { home?: string; homedir?: string; user?: string; host?: string; companies?: string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeRedactor(ctx: RedactContext): { redact: (text: string) => string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const rules: [string, RegExp, string | ((m: string) => string)][] = [];
  /** A folder in either slash style (Windows paths show up both ways), any case on Windows. */
  const path = (label: string, p: string | undefined, to: string) => {
    if (!p || p.length < 3) return;
    const back = p.replace(/\//g, "\\");
    // Also as JSON writes it, each backslash doubled.
    const variants = new Set([p, p.replace(/\\/g, "/"), back, back.replace(/\\/g, "\\\\")]);
    for (const v of variants) rules.push([label, new RegExp(escapeRe(v), "gi"), to]);
  };
  path("home", ctx.home, "<RAWJOBS_HOME>");
  path("homedir", ctx.homedir, "<HOME>");
  rules.push(
    ["token", /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "<telegram-token>"],
    ["chat", /("chat_?id"\s*:\s*"?|chat_id=)-?\d+/gi, (m) => `${m.replace(/-?\d+$/, "")}<chat>`],
    ["secret", /\b(Bearer|token|key|sig|secret|password|Authorization:?)(\s*[=:]\s*|\s+)[^\s"'&,]{8,}/gi, (m) => `${m.split(/[\s=:]/)[0]} <secret>`],
    ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
    ["linkedin", /linkedin\.com\/in\/[^\s"'/?#]+/gi, "linkedin.com/in/<profile>"],
    ["query", /(https?:\/\/[^\s"'?#]+)\?[^\s"'#]+/g, (m) => `${m.split("?")[0]}?<query>`],
    ["ip", /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
    ["phone", /\+\d[\d ()-]{8,}\d/g, "<phone>"],
  );
  if (ctx.user && ctx.user.length >= 3) rules.push(["user", new RegExp(`\\b${escapeRe(ctx.user)}\\b`, "gi"), "<user>"]);
  if (ctx.host && ctx.host.length >= 3) rules.push(["host", new RegExp(`\\b${escapeRe(ctx.host)}\\b`, "gi"), "<host>"]);
  // Longest first, so "Acme Labs" goes before "Acme".
  const companies = [...new Set((ctx.companies ?? []).map((c) => c.trim()).filter((c) => c.length >= 3))].sort((a, b) => b.length - a.length);
  for (const [i, c] of companies.entries()) rules.push(["company", new RegExp(`(?<![A-Za-z0-9])${escapeRe(c)}(?![A-Za-z0-9])`, "gi"), `<company-${i + 1}>`]);
  const redact = (text: string) => {
    let out = text;
    for (const [label, re, to] of rules) {
      out = out.replace(re, (m) => {
        counts[label] = (counts[label] ?? 0) + 1;
        return typeof to === "string" ? to : to(m);
      });
    }
    return out;
  };
  return { redact, counts };
}
