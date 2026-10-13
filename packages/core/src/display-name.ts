/**
 * Company names as people say them, for display only. Hiring systems and slug guesses give us
 * "Getrecharge.Com", "Imc.Com" and "Trust-Wallet"; we show "Recharge", "IMC" and "Trust Wallet".
 * Stored names, keys and config values never change: search keeps matching the raw name too.
 */

/**
 * Hand-kept fixes, by the raw name in lower case. For names no rule can read: glued words and
 * initialisms ("Trmlabs", "Imc.Com"), or real brands a rule would otherwise change ("think-cell").
 */
export const NAME_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["imc.com", "IMC"],
  ["magiceden", "Magic Eden"],
  ["trmlabs", "TRM Labs"],
  ["orderlynetwork", "Orderly Network"],
  ["oplabs", "OP Labs"],
  ["coinmarketcap", "CoinMarketCap"],
  ["aptoslabs", "Aptos Labs"],
  ["mystenlabs", "Mysten Labs"],
  ["seilabs", "Sei Labs"],
  ["bvnk", "BVNK"],
  ["truelayer", "TrueLayer"],
  ["smartasset", "SmartAsset"],
  ["momentmarkets", "Moment"],
  ["swingdev", "SwingDev"],
  ["zoominfo technologies", "ZoomInfo"],
  ["redgate", "Redgate"],
  ["think-cell", "think-cell"],
  ["cargo-partner", "cargo-partner"],
]);

/**
 * Web endings we drop, only when title-cased ("Rillet.Com"). That casing means a machine
 * capitalised a web address. Brands write theirs as they like and keep it: "Crypto.com",
 * "Apollo.io", "Character.AI". Endings that read as words ("Talon.One", "Rocket.Chat") stay.
 */
const MACHINE_TLD = /^([^\s.]{3,})\.(Com|Io|Xyz|Me|Cash|Fi|Co|Inc|Dev|Net|Org|Ai|App)$/;

/**
 * Title-cased endings that are the brand's last word: "Sui.Foundation" is the Sui Foundation. Only
 * this casing, like MACHINE_TLD; "Ramp.Network" stays as its owner writes it.
 */
const WORD_TLD = /^([^\s.]{2,})\.(Foundation|Finance|Labs|Protocol)$/;

/**
 * Legal forms at the end of a registered name: "Gusto, Inc.", "Meshy LLC", "HiveMQ GmbH", "Prophet
 * Tech Pty Ltd". Words that are often the brand's own ("Group", "Corporation", "Technologies", "Co")
 * stay. The short European forms only in capitals, so a name ending in a word like "Sa" or "Ag" keeps it.
 */
const LEGAL_SUFFIX = /,?\s+(?:inc\.?|incorporated|l\.?l\.?c\.?|(?:pvt\.?\s+|private\s+|pty\.?\s+|pte\.?\s+)?(?:ltd\.?|limited)|gmbh|plc|srl|S\.?A\.?S?|S\.?A|AG|B\.?V\.?)\s*$/i;
const CAPITALS_ONLY = /^(?:S\.?A\.?S?|S\.?A|AG|B\.?V\.?)$/i;

/** The name without its legal form(s), or the name itself when that would leave too little. */
function withoutLegalForm(name: string): string {
  let out = name;
  for (let m = LEGAL_SUFFIX.exec(out); m; m = LEGAL_SUFFIX.exec(out)) {
    const form = m[0].replace(/^,?\s+/, "").trim();
    if (CAPITALS_ONLY.test(form) && form !== form.toUpperCase()) break;
    const rest = out.slice(0, m.index).trim();
    if (rest.replace(/[^\p{L}\p{N}]/gu, "").length < 2) break;
    out = rest;
  }
  return out;
}

/** Domain prefixes that sit in front of the brand: getrecharge.com is Recharge. */
const DOMAIN_PREFIXES = ["get", "try", "join", "use", "hello", "meet", "with", "go"];

/** Trailing words that make "Trust-Wallet" a written-out slug rather than a hyphenated brand ("Rite-Hite"). */
const GENERIC_WORDS = new Set(
  "labs lab network networks health wallet solutions security tech technologies marketing strategies group jobs careers retail finance capital systems software studio studios media data digital global partners consulting services foundation protocol markets ventures games".split(
    " ",
  ),
);

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * The brand-like name for a company. `slug` (the board's slug, when known) helps undo
 * domain prefixes ("Getrecharge.Com" on ashby:recharge is "Recharge") and glued words
 * ("Trmlabs" on ashby:trm-labs is "Trm Labs").
 */
export function displayName(name: string, slug?: string): string {
  const full = name.trim();
  if (!full) return full;
  const exact = NAME_OVERRIDES.get(full.toLowerCase());
  if (exact) return exact;
  const raw = withoutLegalForm(full);
  const override = NAME_OVERRIDES.get(raw.toLowerCase());
  if (override) return override;
  const s = (slug ?? "").trim().toLowerCase();

  const word = WORD_TLD.exec(raw);
  if (word) return `${word[1]} ${word[2]}`;

  const domain = MACHINE_TLD.exec(raw);
  if (domain) {
    const base = domain[1]!;
    const bare = s.replace(/[^a-z0-9]/g, "");
    if (bare.length >= 3 && DOMAIN_PREFIXES.some((p) => base.toLowerCase() === p + bare)) return capitalise(bare);
    return base;
  }

  // A slug written out with hyphens: "crossjoin-solutions", or "Trust-Wallet" ending in a generic
  // word. Every part a plain word of 3+ letters, so "d-Matrix", "Q-CTRL", "M-KOPA", "Re-Leased"
  // and "At-Bay" stay as their owners write them, and so do "Rite-Hite" and "Myers-Holum".
  const parts = raw.split("-");
  if (parts.length > 1 && parts.every((p) => /^\p{L}{3,}$/u.test(p))) {
    if (parts.every((p) => p === p.toLowerCase())) return parts.map(capitalise).join(" ");
    if (parts.every((p) => /^\p{Lu}\p{Ll}+$/u.test(p)) && GENERIC_WORDS.has(parts.at(-1)!.toLowerCase())) return parts.join(" ");
  }

  // A glued slug name whose board slug has the word breaks: "Trmlabs" on trm-labs.
  if (/^\p{L}+$/u.test(raw) && /^[a-z]{3,}(-[a-z]{3,})+$/.test(s) && s.replace(/-/g, "") === raw.toLowerCase() && raw === capitalise(raw.toLowerCase())) {
    return s.split("-").map(capitalise).join(" ");
  }
  return raw;
}

/** displayName() for a company row: its name, or its slug when it has none. */
export const companyLabel = (c: { name?: string | null; slug?: string | null }): string => displayName(c.name || c.slug || "", c.slug ?? undefined);
