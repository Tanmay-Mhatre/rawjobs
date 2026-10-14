import { matchesAny, termRegex } from "../text";

/**
 * Industries a person can work in and a company can be in. No AI: companies are tagged from
 * source lists (aliases), from their job titles (terms), or by hand (seed list); people pick
 * theirs, prefilled from their resume (terms).
 */
export type IndustryGroup = "software" | "finance" | "crypto" | "health" | "industry" | "consumer" | "services";

/** The groups the pickers show, broadest first, so someone outside finance doesn't open on trading niches. */
export const INDUSTRY_GROUPS: { id: IndustryGroup; label: string }[] = [
  { id: "software", label: "Software & internet" },
  { id: "finance", label: "Financial services" },
  { id: "health", label: "Health & life sciences" },
  { id: "industry", label: "Industry, energy & transport" },
  { id: "consumer", label: "Consumer, retail & travel" },
  { id: "services", label: "Professional & public services" },
  { id: "crypto", label: "Crypto & trading" },
];

export type Industry = {
  id: string;
  label: string;
  group: IndustryGroup;
  /** Words that signal the industry in job titles and resumes (whole words). Only words that rarely mean anything else. */
  terms: string[];
  /** Words that signal it in job titles only: fine in "Claims Adjuster", too common in a resume ("claims", "game", "fleet"). */
  titleTerms?: string[];
  /** Topic keywords worth adding to a profile in this industry. */
  topics: string[];
  /** Labels other lists use for it (curated segments, crypto-jobs categories). */
  aliases?: string[];
  /** Tag companies from their job titles. Off for words common in every industry (e.g. "compliance"). */
  fromTitles?: boolean;
  /** Only infer from titles when the company already has this industry (e.g. an exchange is a crypto company first). */
  requires?: string;
};

export const INDUSTRIES: Industry[] = [
  // ---------- Software & internet ----------
  {
    id: "saas",
    label: "Enterprise software & SaaS",
    group: "software",
    terms: ["saas", "b2b saas", "enterprise software", "software as a service", "b2b software"],
    // B2B software companies hire these more than anyone; a stray one at a bank stays under 8%.
    titleTerms: ["customer success", "solutions engineer", "solutions consultant", "sales engineer", "implementation consultant", "implementation manager"],
    topics: ["saas", "b2b", "enterprise", "platform"],
    aliases: ["saas", "enterprise software", "b2b"],
    fromTitles: true,
  },
  {
    id: "ai",
    label: "AI & machine learning",
    group: "software",
    // Not "ai" or "ml" alone in a resume: nearly every resume says it now.
    terms: ["machine learning", "artificial intelligence", "llm", "llms", "genai", "generative ai", "deep learning", "computer vision", "nlp", "ai research", "ai lab"],
    titleTerms: ["ai", "ml", "applied scientist", "inference", "model training"],
    topics: ["ai", "machine learning", "llm", "genai"],
    aliases: ["ai"],
    fromTitles: true,
  },
  {
    id: "devtools",
    label: "Developer tools",
    group: "software",
    terms: ["developer tools", "devtools", "developer platform", "api platform", "developer experience", "open source company"],
    titleTerms: ["developer advocate", "developer relations", "devrel", "open source"],
    topics: ["developer platform", "api", "developer experience"],
    aliases: ["devtools"],
    fromTitles: true,
  },
  {
    id: "data",
    label: "Data & analytics",
    group: "software",
    terms: ["data infrastructure", "analytics platform", "business intelligence platform", "data warehouse", "database company"],
    titleTerms: ["database", "databases", "query engine", "storage engine", "observability"],
    topics: ["data platform", "analytics", "data infrastructure", "observability"],
    aliases: ["data"],
    fromTitles: true,
  },
  {
    id: "cloud",
    label: "Cloud & infrastructure",
    group: "software",
    terms: ["cloud infrastructure", "cloud provider", "data center", "data centre", "datacenter", "hosting provider", "iaas", "paas", "cdn"],
    titleTerms: ["hyperscale", "colocation", "critical facilities"],
    topics: ["cloud", "infrastructure", "kubernetes", "data center"],
    aliases: ["cloud", "infrastructure"],
    fromTitles: true,
  },
  {
    id: "cybersecurity",
    label: "Cybersecurity",
    group: "software",
    terms: ["cybersecurity", "cyber security", "security operations", "threat intelligence", "identity and access", "zero trust", "endpoint security"],
    titleTerms: ["security researcher", "threat", "detection engineer", "soc analyst", "penetration tester", "malware"],
    topics: ["security", "identity", "threat detection"],
    aliases: ["cybersecurity", "security"],
    fromTitles: true,
  },
  {
    id: "ecommerce",
    label: "E-commerce & marketplaces",
    group: "software",
    terms: ["e-commerce", "ecommerce", "online marketplace", "quick commerce", "q-commerce", "retail media", "food delivery"],
    titleTerms: ["marketplace", "seller", "sellers"],
    topics: ["e-commerce", "marketplace", "checkout", "conversion"],
    aliases: ["e-commerce", "foodtech", "marketplace"],
    fromTitles: true,
  },
  {
    id: "marketing",
    label: "Marketing, advertising & adtech",
    group: "software",
    terms: ["adtech", "ad tech", "martech", "marketing technology", "advertising agency", "creative agency", "programmatic advertising", "media agency"],
    titleTerms: ["advertising", "programmatic", "media buyer", "media planner", "copywriter", "art director", "ad sales", "ad operations"],
    topics: ["advertising", "adtech", "martech", "programmatic"],
    aliases: ["adtech", "marketing", "advertising"],
    fromTitles: true,
  },
  {
    id: "media",
    label: "Media, publishing & entertainment",
    group: "software",
    terms: ["publishing", "journalism", "newsroom", "broadcasting", "streaming service", "entertainment industry", "film production", "television", "music industry", "creator economy", "podcast"],
    titleTerms: ["editor", "journalist", "reporter", "broadcast", "streaming", "film", "podcast", "music", "content creator", "video producer"],
    topics: ["media", "streaming", "content", "audience"],
    aliases: ["media", "entertainment", "publishing"],
    fromTitles: true,
  },
  {
    id: "gaming",
    label: "Video games & esports",
    group: "software",
    terms: ["video games", "video game", "game studio", "game development", "gaming", "esports"],
    titleTerms: ["game", "games", "gameplay", "level designer", "game designer", "unreal"],
    topics: ["gaming", "games", "live ops", "player"],
    aliases: ["gaming", "games"],
    fromTitles: true,
  },
  {
    id: "edtech",
    label: "Education & edtech",
    group: "software",
    terms: ["edtech", "education technology", "learning platform", "tutoring", "online learning", "higher education", "k-12"],
    titleTerms: ["teacher", "tutor", "instructional designer", "curriculum", "faculty", "lecturer", "professor"],
    topics: ["edtech", "education", "learning"],
    aliases: ["edtech", "education"],
    fromTitles: true,
  },
  {
    id: "hrtech",
    label: "HR tech, staffing & recruiting",
    group: "software",
    terms: ["hr tech", "hrtech", "staffing agency", "recruitment agency", "talent acquisition platform", "payroll software", "hris", "peo"],
    titleTerms: ["recruitment consultant", "staffing", "payroll specialist", "payroll consultant", "placement"],
    topics: ["hr tech", "recruiting", "payroll", "workforce"],
    aliases: ["hr tech", "staffing", "recruiting"],
    fromTitles: true,
  },
  // ---------- Financial services ----------
  {
    id: "fintech",
    label: "Fintech (general)",
    group: "finance",
    terms: ["fintech", "financial technology"],
    titleTerms: ["financial services", "financial products"],
    topics: ["fintech", "financial services", "compliance"],
    aliases: ["fintech", "super app"],
    fromTitles: true,
  },
  {
    id: "payments",
    label: "Payments",
    group: "finance",
    terms: ["payments", "payment processing", "card issuing", "merchant acquiring", "remittance", "remittances", "cross-border payments", "payouts", "money movement"],
    titleTerms: ["payment", "acquiring", "issuing", "merchant"],
    topics: ["payments", "acquiring", "issuing", "checkout", "merchant", "remittance"],
    aliases: ["payments"],
    fromTitles: true,
  },
  {
    id: "banking",
    label: "Banking",
    group: "finance",
    terms: ["banking", "retail banking", "corporate banking", "core banking", "open banking", "transaction banking", "investment banking"],
    titleTerms: ["bank", "banker", "treasury", "teller", "branch manager"],
    topics: ["banking", "open banking", "treasury"],
    aliases: ["bank", "open banking"],
    fromTitles: true,
  },
  {
    id: "digital-bank",
    label: "Digital bank / neobank",
    group: "finance",
    terms: ["neobank", "digital bank", "digital banking", "challenger bank", "mobile banking"],
    topics: ["neobank", "digital banking", "mobile app"],
    aliases: ["digital bank"],
    fromTitles: true,
  },
  {
    id: "lending",
    label: "Lending & BNPL",
    group: "finance",
    terms: ["lending", "loans", "bnpl", "buy now pay later", "mortgage lending", "consumer credit", "credit risk"],
    titleTerms: ["loan officer", "mortgage", "loan processor", "credit analyst"],
    topics: ["lending", "bnpl", "credit"],
    aliases: ["lending", "bnpl"],
    fromTitles: true,
  },
  {
    id: "wealth",
    label: "Wealth & asset management",
    group: "finance",
    terms: ["wealth management", "asset management", "investment management", "robo advisor", "robo-advisor", "investing app", "private equity", "hedge fund", "venture capital"],
    titleTerms: ["wealth", "portfolio manager", "investment analyst", "financial advisor", "financial adviser", "fund accountant", "investor relations"],
    topics: ["wealth", "investing", "asset management"],
    aliases: ["wealth", "investment"],
    fromTitles: true,
  },
  {
    id: "insurtech",
    label: "Insurance & insurtech",
    group: "finance",
    terms: ["insurance", "insurtech", "reinsurance", "policyholder"],
    titleTerms: ["claims", "adjuster", "actuary", "actuarial"],
    topics: ["insurance", "insurtech", "claims"],
    aliases: ["insurtech", "insurance"],
    fromTitles: true,
  },
  {
    id: "regtech",
    label: "Regtech & financial crime",
    group: "finance",
    terms: ["regtech", "financial crime", "anti-money laundering", "kyc", "aml", "fraud prevention", "transaction monitoring"],
    // Banks hire for KYC and AML too, so only a company where they're a big share of jobs counts.
    titleTerms: ["sanctions", "fraud analyst", "fraud investigator"],
    topics: ["kyc", "aml", "compliance", "fraud"],
    aliases: ["regtech", "regulator / free zone"],
    fromTitles: true,
  },
  // ---------- Crypto & trading ----------
  {
    id: "crypto",
    label: "Crypto & Web3",
    group: "crypto",
    // Not "token": API and auth tokens show up in every engineer's resume.
    terms: ["crypto", "cryptocurrency", "web3", "blockchain", "defi", "bitcoin", "ethereum", "onchain", "on-chain", "stablecoin", "stablecoins", "nft", "solana", "tokenomics"],
    titleTerms: ["smart contract", "smart contracts", "solidity"],
    topics: ["crypto", "web3", "blockchain", "defi", "stablecoin", "wallet"],
    aliases: ["crypto", "web3", "crypto infrastructure", "ecosystem", "stablecoins"],
    fromTitles: true,
  },
  {
    id: "crypto-exchange",
    label: "Crypto exchange",
    group: "crypto",
    terms: ["crypto exchange", "cryptocurrency exchange", "spot trading", "perpetuals", "perps", "copy trading", "margin trading"],
    titleTerms: ["futures", "derivatives", "p2p", "listing", "listings"],
    topics: ["exchange", "trading", "futures", "derivatives", "p2p", "crypto"],
    aliases: ["crypto exchange"],
    fromTitles: true,
    requires: "crypto",
  },
  {
    id: "digital-assets",
    label: "Digital assets & custody",
    group: "crypto",
    terms: ["digital assets", "digital asset", "institutional crypto", "crypto custody", "staking"],
    titleTerms: ["custody"],
    topics: ["custody", "digital assets", "staking"],
    aliases: ["digital assets", "custody"],
    fromTitles: true,
    requires: "crypto",
  },
  {
    id: "tokenization",
    label: "Tokenization & RWA",
    group: "crypto",
    terms: ["tokenization", "tokenisation", "rwa", "real world assets", "real-world assets", "tokenized", "tokenised", "security tokens"],
    topics: ["tokenization", "rwa", "real world assets"],
    aliases: ["tokenization"],
    fromTitles: true,
  },
  {
    id: "brokerage",
    label: "Brokerage, CFD & FX",
    group: "crypto",
    // Not "broker" (insurance/mortgage brokers), "fx" (FX payment firms) or "affiliates" (any partner programme).
    terms: ["cfd", "cfds", "forex", "mt4", "mt5", "metatrader", "dealing desk", "retail trading", "online trading", "introducing broker", "prop firm", "online brokerage"],
    topics: ["trading", "brokerage", "cfd", "forex", "mt5", "metatrader"],
    aliases: ["brokerage"],
    fromTitles: true,
  },
  {
    id: "trading-tech",
    label: "Trading technology",
    group: "crypto",
    terms: [
      "trading platform",
      "trading systems",
      "trading technology",
      "order management system",
      "execution management",
      "low latency",
      "market data",
      "matching engine",
      "fix protocol",
      "algorithmic trading",
      "electronic trading",
    ],
    titleTerms: ["oms", "order management"],
    topics: ["trading platform", "market data", "low latency", "order management"],
    aliases: ["trading tech"],
    fromTitles: true,
  },
  {
    id: "market-making",
    label: "Market making & prop trading",
    group: "crypto",
    terms: [
      "market making",
      "market maker",
      "quantitative trading",
      "quant trader",
      "quantitative researcher",
      "proprietary trading",
      "prop trading",
      "liquidity provider",
      "hft",
      "high-frequency trading",
    ],
    titleTerms: ["trader", "quant"],
    topics: ["market making", "liquidity", "quantitative trading"],
    aliases: ["market making"],
    fromTitles: true,
  },
  // ---------- Health & life sciences ----------
  {
    id: "healthtech",
    label: "Healthcare & healthtech",
    group: "health",
    terms: ["healthtech", "healthcare", "health care", "telehealth", "telemedicine", "digital health", "patient care", "hospital", "hospitals", "clinic", "registered nurse", "nursing"],
    titleTerms: ["nurse", "nursing", "physician", "clinician", "patient", "pharmacist", "pharmacy", "medical assistant", "therapist", "dental", "caregiver", "care coordinator", "behavioral health"],
    topics: ["healthcare", "healthtech", "patient", "clinical"],
    aliases: ["healthtech", "health", "healthcare"],
    fromTitles: true,
  },
  {
    id: "biotech",
    label: "Biotech & pharma",
    group: "health",
    terms: [
      "biotech",
      "biotechnology",
      "pharma",
      "pharmaceutical",
      "pharmaceuticals",
      "life sciences",
      "drug discovery",
      "drug development",
      "clinical trials",
      "clinical research",
      "genomics",
      "medical devices",
      "medtech",
    ],
    titleTerms: [
      "clinical trial",
      "clinical operations",
      "clinical development",
      "regulatory affairs",
      "pharmacovigilance",
      "medical science liaison",
      "cmc",
      "assay",
      "antibody",
      "bioinformatics",
      "biologist",
      "chemist",
      "gmp",
      "translational",
    ],
    topics: ["biotech", "pharma", "clinical trials", "life sciences"],
    aliases: ["biotech", "pharma", "life sciences", "medtech"],
    fromTitles: true,
  },
  // ---------- Industry, energy & transport ----------
  {
    id: "climate",
    label: "Climate & energy",
    group: "industry",
    terms: [
      "climate tech",
      "climatetech",
      "clean energy",
      "renewable energy",
      "renewables",
      "solar energy",
      "wind energy",
      "energy storage",
      "decarbonization",
      "decarbonisation",
      "oil and gas",
      "power grid",
      "ev charging",
      "carbon removal",
    ],
    titleTerms: ["energy", "solar", "wind", "battery", "grid", "utility", "renewable", "climate", "carbon", "power plant", "substation", "nuclear", "hydrogen"],
    topics: ["climate", "energy", "renewables", "sustainability"],
    aliases: ["climate", "energy", "cleantech"],
    fromTitles: true,
  },
  {
    id: "hardware",
    label: "Hardware & semiconductors",
    group: "industry",
    terms: ["semiconductor", "semiconductors", "chip design", "asic", "fpga", "vlsi", "consumer electronics"],
    titleTerms: ["silicon", "rtl", "physical design", "analog", "pcb", "hardware", "firmware", "electrical engineer", "design verification", "photonics"],
    topics: ["hardware", "semiconductors", "embedded", "firmware"],
    aliases: ["hardware", "semiconductors"],
    fromTitles: true,
  },
  {
    id: "robotics",
    label: "Robotics & automation",
    group: "industry",
    terms: ["robotics", "industrial automation", "mechatronics", "autonomous robots"],
    titleTerms: ["robot", "robots", "autonomy", "perception", "motion planning", "controls engineer", "plc"],
    topics: ["robotics", "autonomy", "automation"],
    aliases: ["robotics", "automation"],
    fromTitles: true,
  },
  {
    id: "manufacturing",
    label: "Manufacturing & industrial",
    group: "industry",
    terms: ["manufacturing", "industrial manufacturing", "factory", "production plant"],
    titleTerms: [
      "machinist",
      "cnc",
      "assembler",
      "assembly technician",
      "assembly operator",
      "welder",
      "welding",
      "production operator",
      "production supervisor",
      "plant manager",
      "process technician",
      "maintenance technician",
      "quality technician",
      "machine operator",
    ],
    topics: ["manufacturing", "operations", "supply chain", "quality"],
    aliases: ["manufacturing", "industrial"],
    fromTitles: true,
  },
  {
    id: "automotive",
    label: "Automotive & EVs",
    group: "industry",
    terms: ["automotive", "electric vehicles", "electric vehicle", "autonomous driving", "self-driving", "adas", "powertrain"],
    titleTerms: ["vehicle", "vehicles", "ev", "battery cell", "automotive technician", "dealership"],
    topics: ["automotive", "electric vehicles", "autonomous driving"],
    aliases: ["automotive", "ev"],
    fromTitles: true,
  },
  {
    id: "aerospace",
    label: "Aerospace & defense",
    group: "industry",
    terms: ["aerospace", "defense contractor", "defence industry", "defense industry", "avionics", "spacecraft", "satellites", "space industry", "launch vehicles"],
    titleTerms: ["aircraft", "satellite", "propulsion", "flight software", "uav", "drone", "drones", "defense", "defence", "missile", "ts/sci", "security clearance", "clearance"],
    topics: ["aerospace", "defense", "space"],
    aliases: ["aerospace", "defense", "defence", "space"],
    fromTitles: true,
  },
  {
    id: "telecom",
    label: "Telecom & networking",
    group: "industry",
    terms: ["telecom", "telecommunications", "telco", "5g", "lte", "wireless networks", "mobile network operator", "fiber broadband", "isp"],
    titleTerms: ["rf engineer", "ran", "fiber", "fibre", "wireless", "tower technician"],
    topics: ["telecom", "5g", "networking", "wireless"],
    aliases: ["telecom", "telecommunications"],
    fromTitles: true,
  },
  {
    id: "mobility",
    label: "Mobility & transportation",
    group: "industry",
    // Not bare "mobility" in a resume: headings and visa sections use it ("work authorization & mobility", "global mobility").
    terms: [
      "ride hailing",
      "ride-hailing",
      "rideshare",
      "micromobility",
      "public transport",
      "public transit",
      "car sharing",
      "mobility as a service",
      "maas",
      "shared mobility",
      "urban mobility",
      "mobility platform",
    ],
    titleTerms: ["mobility", "transit", "rail", "railway", "airline", "aviation", "pilot", "flight attendant", "bus operator", "bus driver", "rideshare"],
    topics: ["mobility", "transportation"],
    aliases: ["mobility", "transportation"],
    fromTitles: true,
  },
  {
    id: "logistics",
    label: "Logistics & supply chain",
    group: "industry",
    terms: ["logistics", "supply chain", "freight", "last mile", "last-mile", "fulfillment center", "fulfilment centre", "3pl", "trucking"],
    titleTerms: ["warehouse", "fleet", "dispatcher", "courier", "delivery driver", "cdl", "forklift"],
    topics: ["logistics", "supply chain", "operations"],
    aliases: ["logistics", "supply chain"],
    fromTitles: true,
  },
  {
    id: "construction",
    label: "Construction & engineering",
    group: "industry",
    terms: ["construction", "general contractor", "civil engineering", "infrastructure projects"],
    titleTerms: ["superintendent", "estimator", "foreman", "site engineer", "civil engineer", "structural engineer", "electrician", "hvac", "plumber", "carpenter", "surveyor"],
    topics: ["construction", "engineering", "project delivery"],
    aliases: ["construction", "engineering services"],
    fromTitles: true,
  },
  {
    id: "agriculture",
    label: "Agriculture & food production",
    group: "industry",
    terms: ["agriculture", "agtech", "agritech", "farming", "agribusiness", "food production"],
    titleTerms: ["agronomist", "agricultural", "farm", "crop", "livestock", "horticulture"],
    topics: ["agriculture", "agtech", "food"],
    aliases: ["agriculture", "agtech"],
    fromTitles: true,
  },
  // ---------- Consumer, retail & travel ----------
  {
    id: "retail",
    label: "Retail, fashion & consumer goods",
    group: "consumer",
    terms: ["retail", "consumer goods", "cpg", "fmcg", "consumer packaged goods", "fashion", "apparel", "cosmetics", "luxury goods"],
    titleTerms: ["store manager", "store associate", "retail associate", "retail sales associate", "merchandiser", "boutique", "stylist", "cashier", "beauty advisor"],
    topics: ["retail", "consumer", "brand", "merchandising"],
    aliases: ["retail", "consumer goods", "consumer", "fashion"],
    fromTitles: true,
  },
  {
    id: "food",
    label: "Food, beverage & restaurants",
    group: "consumer",
    terms: ["food and beverage", "food & beverage", "restaurant", "restaurants", "beverage", "food science", "quick service restaurant"],
    titleTerms: ["chef", "cook", "line cook", "sous chef", "barista", "kitchen", "culinary", "server", "bartender", "food safety", "baker"],
    topics: ["food", "beverage", "restaurants"],
    aliases: ["food", "food and beverage", "restaurants"],
    fromTitles: true,
  },
  {
    id: "travel",
    label: "Travel & hospitality",
    group: "consumer",
    terms: ["travel", "hospitality", "travel tech", "online travel", "hotels", "airlines", "tourism"],
    titleTerms: ["hotel", "housekeeping", "housekeeper", "guest services", "resort", "tour guide"],
    topics: ["travel", "booking", "hospitality"],
    aliases: ["travel", "hospitality"],
    fromTitles: true,
  },
  {
    id: "proptech",
    label: "Real estate & proptech",
    group: "consumer",
    terms: ["proptech", "real estate", "property management", "mortgage broker", "commercial real estate"],
    titleTerms: ["property manager", "leasing", "leasing consultant", "realtor", "real estate agent"],
    topics: ["real estate", "proptech"],
    aliases: ["proptech", "real estate"],
    fromTitles: true,
  },
  {
    id: "betting",
    label: "Betting & iGaming",
    group: "consumer",
    terms: ["igaming", "betting", "sportsbook", "online casino", "sports betting", "lottery"],
    titleTerms: ["casino", "sportsbook trader", "odds compiler"],
    topics: ["igaming", "betting", "sportsbook"],
    aliases: ["betting", "igaming"],
    fromTitles: true,
  },
  {
    id: "sports",
    label: "Sports & fitness",
    group: "consumer",
    terms: ["sports", "fitness", "sports technology", "athletics"],
    titleTerms: ["personal trainer", "fitness instructor", "fitness coach", "strength coach", "athletic trainer", "gym", "athletics"],
    topics: ["sports", "fitness", "wellness"],
    aliases: ["sports", "fitness"],
    fromTitles: true,
  },
  // ---------- Professional & public services ----------
  {
    id: "consulting",
    label: "Consulting, audit & professional services",
    group: "services",
    terms: ["management consulting", "consulting firm", "professional services firm", "big four", "audit firm", "accounting firm", "advisory firm"],
    titleTerms: ["management consultant", "strategy consultant", "consulting analyst", "consulting manager", "advisory", "audit", "auditor", "tax manager", "tax senior", "tax associate"],
    topics: ["consulting", "advisory", "strategy"],
    aliases: ["consulting", "professional services"],
    fromTitles: true,
  },
  {
    id: "legal",
    label: "Legal & legaltech",
    group: "services",
    terms: ["legaltech", "legal tech", "law firm", "legal services", "e-discovery", "ediscovery"],
    titleTerms: ["attorney", "lawyer", "paralegal", "legal assistant", "litigation", "legal secretary", "solicitor"],
    topics: ["legal", "legaltech", "compliance"],
    aliases: ["legal", "legaltech"],
    fromTitles: true,
  },
  {
    id: "government",
    label: "Government & public sector",
    group: "services",
    terms: ["government", "public sector", "govtech", "civic tech", "federal government", "local government", "public administration"],
    titleTerms: ["civic", "federal", "municipal", "public policy", "public affairs"],
    topics: ["government", "public sector", "policy"],
    aliases: ["government", "public sector", "govtech"],
    fromTitles: true,
  },
  {
    id: "nonprofit",
    label: "Nonprofit & social impact",
    group: "services",
    terms: ["nonprofit", "non-profit", "not-for-profit", "charity", "philanthropy", "ngo", "social impact"],
    titleTerms: ["fundraising", "development officer", "grant writer", "grants", "program officer", "advocacy", "volunteer", "donor"],
    topics: ["nonprofit", "social impact", "fundraising"],
    aliases: ["nonprofit", "non-profit", "social impact"],
    fromTitles: true,
  },
];

export const INDUSTRY_BY_ID = new Map(INDUSTRIES.map((i) => [i.id, i]));

/** Below this many live companies to scan, an industry is flagged as having few companies. */
export const FEW_COMPANIES = 15;

/** A company's industries: from source lists and the seed list, and from its job titles. */
export const companyIndustries = (c: { tags?: readonly string[]; title_tags?: readonly string[] }): string[] => [...new Set([...(c.tags ?? []), ...(c.title_tags ?? [])])];

/** How many of these companies are in each industry (every industry listed, 0 when none). */
export function industryCounts(companies: readonly { tags?: readonly string[]; title_tags?: readonly string[] }[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(INDUSTRIES.map((i) => [i.id, 0]));
  for (const c of companies) for (const id of companyIndustries(c)) if (id in counts) counts[id]!++;
  return counts;
}

/** Taxonomy ids for a label from another list ("crypto exchange" -> crypto + crypto-exchange). Unknown -> []. */
export function industriesForLabel(label: string | undefined): string[] {
  const l = label?.toLowerCase().trim();
  if (!l) return [];
  const ids = INDUSTRY_BY_ID.has(l) ? [l] : INDUSTRIES.filter((i) => i.label.toLowerCase() === l || i.aliases?.includes(l)).map((i) => i.id);
  // An exchange or custodian is a crypto company too.
  if (ids.some((id) => ["crypto-exchange", "digital-assets", "tokenization"].includes(id)) && !ids.includes("crypto")) ids.unshift("crypto");
  return ids;
}

const titleTermCache = new Map<string, { roles: string[]; generic: string[] }>();
/** What counts in a job title: the role words (`titleTerms`) anywhere, and the industry's generic `terms`. */
function titleTermsOf(ind: Industry) {
  let t = titleTermCache.get(ind.id);
  if (!t) {
    const roles = ind.titleTerms ?? [];
    titleTermCache.set(ind.id, (t = { roles, generic: ind.terms.filter((w) => !roles.includes(w)) }));
  }
  return t;
}

/**
 * Business-to-business selling roles, whose titles name the customer segment they sell to
 * ("Account Executive, Retail", "Healthcare Solutions Engineer"), not what the company is. Not
 * store or agency sales ("Sales Associate", "Insurance Sales Agent", "Pharmaceutical Sales
 * Specialist"): there the word is what the company sells.
 */
const SEGMENT_ROLE =
  /(?<![\p{L}\p{N}])(?:(?:key |strategic |enterprise |named |global |major |territory |inside |field )?account (?:executive|manager|director|lead|management|strategist|partner)|aes?|business development|bdrs?|sdrs?|sales (?:development|engineer|engineering|executive|director|manager|lead|leader)|pre-?sales|solutions? (?:engineer|consultant|architect)|customer success|client success|partnerships?|partner (?:manager|development)|alliances?|channel (?:manager|partner|sales|account)|go[ -]to[ -]market|gtm|industry (?:lead|principal|director|manager|advisor|specialist|strategist|marketing|solutions?)|vertical|implementation (?:consultant|manager|specialist|lead)|product marketing|mid[ -]?market)(?![\p{L}\p{N}])/iu;

/** "Sales to Retailers", "Engineer for Banks": what follows is who the work is for. */
const FOR_TO = /(?<![\p{L}\p{N}])(?:for|to)(?![\p{L}\p{N}])/iu;

/** For "strict" only: any sales or marketing title, and anything after a comma, dash, pipe, colon or bracket. */
const ANY_GTM =
  /(?<![\p{L}\p{N}])(?:account (?:executive|manager|director|lead|management)|aes?|sales|pre-?sales|business development|bdrs?|sdrs?|partnerships?|partner (?:manager|development)|alliances?|channel (?:manager|partner|sales)|solutions? (?:engineer|consultant|architect|specialist|manager|lead|director)|customer success|csms?|client success|marketing|go[ -]to[ -]market|gtm|implementation|onboarding (?:manager|specialist|consultant)|industry (?:lead|principal|director|manager|advisor|specialist|strategist)|vertical|segment|growth (?:manager|lead))(?![\p{L}\p{N}])/iu;
const QUALIFIER = /,|\s[-–—]\s|\s?[–—|:([]|(?<![\p{L}\p{N}])(?:for|to)(?![\p{L}\p{N}])/iu;

/**
 * Industries whose generic words often name a kind of customer ("Account Executive, Retail" at a
 * restaurant-software company) rather than the product ("SaaS BDR", "Cybersecurity Solutions
 * Architect", which say what the company sells).
 */
// biome-ignore format: a word list, kept compact
export const SEGMENT_INDUSTRIES: ReadonlySet<string> = new Set([
  "retail", "healthtech", "biotech", "banking", "lending", "wealth", "insurtech", "fintech", "government", "food", "travel", "proptech",
  "manufacturing", "logistics", "construction", "automotive", "aerospace", "edtech", "legal", "nonprofit", "media", "telecom", "sports",
  "mobility", "agriculture", "climate", "gaming", "ecommerce", "betting", "consulting",
]);

/**
 * How an industry's generic words ("retail", "healthcare", "banking") count in job titles. Its role
 * words (`titleTerms`: "Store Manager", "Cashier") always count.
 * - "segment" (used): for SEGMENT_INDUSTRIES, not in a business-to-business selling role's title
 *   and not after "for"/"to", where they name who the company sells to.
 * - "strict": not after a comma, dash, pipe, colon or bracket either (team names: "Engineer,
 *   Payments"), nor in any sales or marketing title, for every industry.
 * - "all": anywhere (the rule before 2026-10-14). "none": never, role words only.
 * The last three are kept for scripts/catalog/industry-precision.ts.
 */
export type GenericTitleTerms = "segment" | "strict" | "all" | "none";

/** The part of a title where generic industry words count ("" for none), for the segment industries under `generic`. */
export function titleRolePart(title: string, generic: GenericTitleTerms = "segment"): string {
  if (generic === "all") return title;
  if (generic === "none" || (generic === "strict" ? ANY_GTM : SEGMENT_ROLE).test(title)) return "";
  const cut = title.search(generic === "strict" ? QUALIFIER : FOR_TO);
  return cut <= 0 ? title : title.slice(0, cut);
}

/**
 * Industries a company's job titles point to: at least 8% of the titles (and at least 2) mention
 * the industry's role words, or its generic words where they describe the company (see
 * `GenericTitleTerms`). Industries with `requires` need that industry already (from `known` or titles).
 */
export function industriesFromTitles(titles: readonly string[], known: readonly string[] = [], generic: GenericTitleTerms = "segment"): string[] {
  if (titles.length === 0) return [];
  const min = Math.max(2, Math.ceil(titles.length * 0.08));
  const heads = titles.map((t) => titleRolePart(t, generic));
  const found: string[] = [];
  for (const ind of INDUSTRIES) {
    if (!ind.fromTitles) continue;
    const { roles, generic: words } = titleTermsOf(ind);
    const where = generic === "segment" && !SEGMENT_INDUSTRIES.has(ind.id) ? titles : heads;
    let hits = 0;
    for (let i = 0; i < titles.length; i++) if ((matchesAny(titles[i]!, roles) || (where[i] !== "" && matchesAny(where[i]!, words))) && ++hits >= min) break;
    if (hits >= min) found.push(ind.id);
  }
  const have = new Set([...known, ...found]);
  return found.filter((id) => {
    const req = INDUSTRY_BY_ID.get(id)!.requires;
    return !req || have.has(req);
  });
}

export type IndustryEvidence = { id: string; count: number /** Its most mentioned terms, with counts. */; terms: [string, number][] };

const evidenceCache = new Map<string, { re: RegExp; terms: string[] }>();
/** One pattern per industry, longest term first, so "cross-border payments" counts once, not also as "payments". */
function evidencePattern(ind: Industry) {
  let p = evidenceCache.get(ind.id);
  if (!p) {
    const terms = [...ind.terms].sort((a, b) => b.length - a.length);
    evidenceCache.set(ind.id, (p = { re: new RegExp(terms.map((t) => `(?:${termRegex(t).source})`).join("|"), "giu"), terms }));
  }
  return p;
}

/** Industries a text mentions at least `minMentions` times (whole words, `terms` only), most mentioned first; ties keep catalog order. */
export function industryEvidence(text: string, minMentions = 2): IndustryEvidence[] {
  const out: IndustryEvidence[] = [];
  for (const ind of INDUSTRIES) {
    const { re, terms } = evidencePattern(ind);
    const byTerm = new Map<string, number>();
    for (const m of text.matchAll(re)) {
      const term = terms.find((t) => termRegex(t).test(m[0])) ?? m[0].toLowerCase();
      byTerm.set(term, (byTerm.get(term) ?? 0) + 1);
    }
    const count = [...byTerm.values()].reduce((sum, n) => sum + n, 0);
    if (count >= minMentions) out.push({ id: ind.id, count, terms: [...byTerm].sort((a, b) => b[1] - a[1]).slice(0, 3) });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Industries a resume mentions at least twice, most mentioned first. */
export const industriesFromText = (text: string, minMentions = 2): string[] => industryEvidence(text, minMentions).map((e) => e.id);
