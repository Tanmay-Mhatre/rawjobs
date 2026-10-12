export const REMOTE_EXCLUDE_SUGGESTIONS = ["us", "usa", "united states", "canada", "americas", "latam", "apac", "india"];

export type KeywordPack = { id: string; label: string; keywords: Record<string, number> };

export const KEYWORD_PACKS: KeywordPack[] = [
  {
    id: "crypto",
    label: "Crypto & Web3",
    keywords: { crypto: 5, blockchain: 4, web3: 4, defi: 4, stablecoin: 4, tokenization: 4, rwa: 4, exchange: 3, custody: 3, wallet: 3 },
  },
  {
    id: "fintech",
    label: "Fintech",
    keywords: { fintech: 4, payments: 4, banking: 3, lending: 3, neobank: 3, "open banking": 3, cards: 2 },
  },
  {
    id: "payments",
    label: "Payments",
    keywords: { payments: 5, acquiring: 3, issuing: 3, merchant: 3, checkout: 3, remittance: 3, "cross border": 3 },
  },
  {
    id: "ai",
    label: "AI & ML",
    keywords: { ai: 4, "machine learning": 4, llm: 4, genai: 4, "generative ai": 4, ml: 3 },
  },
  {
    id: "compliance",
    label: "Compliance & Risk",
    keywords: { kyc: 3, aml: 3, compliance: 3, fraud: 3, regtech: 3, risk: 2 },
  },
  {
    id: "saas",
    label: "B2B SaaS & APIs",
    keywords: { b2b: 3, saas: 3, api: 3, platform: 2, enterprise: 2 },
  },
  {
    id: "consumer",
    label: "Consumer & Growth",
    keywords: { growth: 3, consumer: 3, "mobile app": 3, monetization: 3, retention: 2 },
  },
  {
    id: "commerce",
    label: "Marketplaces & Commerce",
    keywords: { marketplace: 3, "e commerce": 3, retail: 2, logistics: 2 },
  },
];

/** Terms the CV scanner looks for: every pack keyword plus a few more domain words. */
export const CV_DICTIONARY: Record<string, number> = {
  ...Object.assign({}, ...KEYWORD_PACKS.map((p) => p.keywords)),
  "digital assets": 4,
  trading: 3,
  brokerage: 3,
  wealth: 3,
  insurance: 3,
  insurtech: 3,
  "real estate": 3,
  proptech: 3,
  healthtech: 3,
  edtech: 3,
  cybersecurity: 3,
  identity: 2,
  onboarding: 2,
  "data platform": 2,
  analytics: 2,
  experimentation: 2,
  pricing: 2,
  b2c: 3,
  micromobility: 3,
  "super app": 3,
};
