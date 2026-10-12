/**
 * Worldwide places for setup: every country with common aliases and its main job-market cities,
 * plus the region words job ads use for remote roles. All lowercase, matched as whole words.
 */
export type Country = { name: string; aliases: string[]; cities: string[] };
export type Region = { name: string; aliases: string[]; hint: string };

const c = (name: string, aliases: string[], cities: string[]): Country => ({ name, aliases, cities });

export const COUNTRIES: Country[] = [
  // Middle East & North Africa
  c("united arab emirates", ["uae", "emirates"], ["dubai", "abu dhabi", "sharjah", "ajman", "ras al khaimah"]),
  c("saudi arabia", ["ksa"], ["riyadh", "jeddah", "dammam", "khobar", "neom"]),
  c("qatar", [], ["doha"]),
  c("bahrain", [], ["manama"]),
  c("kuwait", [], ["kuwait city"]),
  c("oman", [], ["muscat"]),
  c("jordan", [], ["amman"]),
  c("lebanon", [], ["beirut"]),
  c("egypt", [], ["cairo", "alexandria", "giza"]),
  c("morocco", [], ["casablanca", "rabat", "marrakech", "tangier"]),
  c("tunisia", [], ["tunis"]),
  c("algeria", [], ["algiers", "oran"]),
  c("libya", [], ["tripoli", "benghazi"]),
  c("iraq", [], ["baghdad", "erbil", "basra"]),
  c("iran", [], ["tehran", "isfahan"]),
  c("israel", [], ["tel aviv", "jerusalem", "haifa", "herzliya"]),
  c("palestine", [], ["ramallah"]),
  c("syria", [], ["damascus", "aleppo"]),
  c("yemen", [], ["sanaa", "aden"]),
  c("turkey", ["turkiye", "türkiye"], ["istanbul", "ankara", "izmir"]),
  c("cyprus", [], ["nicosia", "limassol", "larnaca"]),
  // Europe
  c(
    "united kingdom",
    ["uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
    ["london", "manchester", "edinburgh", "birmingham", "bristol", "cambridge", "oxford", "leeds", "glasgow", "belfast"],
  ),
  c("ireland", [], ["dublin", "cork", "galway", "limerick"]),
  c("france", [], ["paris", "lyon", "marseille", "toulouse", "nice", "bordeaux"]),
  c("germany", ["deutschland"], ["berlin", "munich", "hamburg", "frankfurt", "cologne", "stuttgart", "düsseldorf"]),
  c("netherlands", ["holland"], ["amsterdam", "rotterdam", "the hague", "utrecht", "eindhoven"]),
  c("belgium", [], ["brussels", "antwerp", "ghent"]),
  c("luxembourg", [], ["luxembourg city"]),
  c("switzerland", [], ["zurich", "geneva", "basel", "lausanne", "zug", "bern"]),
  c("austria", [], ["vienna", "graz", "linz"]),
  c("spain", [], ["madrid", "barcelona", "valencia", "seville", "malaga"]),
  c("portugal", [], ["lisbon", "porto", "braga"]),
  c("italy", [], ["milan", "rome", "turin", "bologna", "florence", "naples"]),
  c("malta", [], ["valletta", "sliema"]),
  c("greece", [], ["athens", "thessaloniki"]),
  c("sweden", [], ["stockholm", "gothenburg", "malmö"]),
  c("norway", [], ["oslo", "bergen", "trondheim"]),
  c("denmark", [], ["copenhagen", "aarhus"]),
  c("finland", [], ["helsinki", "espoo", "tampere"]),
  c("iceland", [], ["reykjavik"]),
  c("estonia", [], ["tallinn", "tartu"]),
  c("latvia", [], ["riga"]),
  c("lithuania", [], ["vilnius", "kaunas"]),
  c("poland", [], ["warsaw", "krakow", "wroclaw", "gdansk", "poznan"]),
  c("czech republic", ["czechia"], ["prague", "brno"]),
  c("slovakia", [], ["bratislava"]),
  c("hungary", [], ["budapest"]),
  c("romania", [], ["bucharest", "cluj napoca", "iasi"]),
  c("bulgaria", [], ["sofia", "plovdiv", "varna"]),
  c("serbia", [], ["belgrade", "novi sad"]),
  c("croatia", [], ["zagreb", "split"]),
  c("slovenia", [], ["ljubljana"]),
  c("bosnia and herzegovina", ["bosnia"], ["sarajevo"]),
  c("north macedonia", ["macedonia"], ["skopje"]),
  c("albania", [], ["tirana"]),
  c("montenegro", [], ["podgorica"]),
  c("kosovo", [], ["pristina"]),
  c("moldova", [], ["chisinau"]),
  c("ukraine", [], ["kyiv", "kiev", "lviv", "kharkiv", "odesa"]),
  c("belarus", [], ["minsk"]),
  c("russia", ["russian federation"], ["moscow", "saint petersburg"]),
  c("georgia", [], ["tbilisi", "batumi"]),
  c("armenia", [], ["yerevan"]),
  c("azerbaijan", [], ["baku"]),
  c("monaco", [], ["monte carlo"]),
  c("liechtenstein", [], ["vaduz"]),
  c("andorra", [], ["andorra la vella"]),
  c("san marino", [], ["san marino"]),
  c("gibraltar", [], ["gibraltar"]),
  // North America
  c(
    "united states",
    ["usa", "us", "united states of america", "america"],
    ["new york", "san francisco", "los angeles", "seattle", "austin", "boston", "chicago", "miami", "washington dc", "denver", "atlanta", "dallas"],
  ),
  c("canada", [], ["toronto", "vancouver", "montreal", "calgary", "ottawa", "waterloo"]),
  c("mexico", [], ["mexico city", "guadalajara", "monterrey"]),
  // Central America & Caribbean
  c("guatemala", [], ["guatemala city"]),
  c("belize", [], ["belize city"]),
  c("honduras", [], ["tegucigalpa", "san pedro sula"]),
  c("el salvador", [], ["san salvador"]),
  c("nicaragua", [], ["managua"]),
  c("costa rica", [], ["san jose"]),
  c("panama", [], ["panama city"]),
  c("cuba", [], ["havana"]),
  c("dominican republic", [], ["santo domingo"]),
  c("jamaica", [], ["kingston"]),
  c("puerto rico", [], ["san juan"]),
  c("bahamas", [], ["nassau"]),
  c("barbados", [], ["bridgetown"]),
  c("trinidad and tobago", ["trinidad"], ["port of spain"]),
  c("haiti", [], ["port au prince"]),
  c("cayman islands", [], ["george town"]),
  c("bermuda", [], ["hamilton"]),
  // South America
  c("brazil", ["brasil"], ["são paulo", "sao paulo", "rio de janeiro", "belo horizonte", "brasilia", "curitiba", "porto alegre"]),
  c("argentina", [], ["buenos aires", "cordoba", "rosario"]),
  c("chile", [], ["santiago", "valparaiso"]),
  c("colombia", [], ["bogota", "medellin", "cali"]),
  c("peru", [], ["lima"]),
  c("uruguay", [], ["montevideo"]),
  c("paraguay", [], ["asuncion"]),
  c("bolivia", [], ["la paz", "santa cruz"]),
  c("ecuador", [], ["quito", "guayaquil"]),
  c("venezuela", [], ["caracas"]),
  c("guyana", [], ["georgetown"]),
  c("suriname", [], ["paramaribo"]),
  // Asia
  c("india", [], ["bangalore", "bengaluru", "mumbai", "delhi", "new delhi", "gurgaon", "gurugram", "noida", "hyderabad", "pune", "chennai", "kolkata", "ahmedabad"]),
  c("pakistan", [], ["karachi", "lahore", "islamabad"]),
  c("bangladesh", [], ["dhaka", "chittagong"]),
  c("sri lanka", [], ["colombo"]),
  c("nepal", [], ["kathmandu"]),
  c("bhutan", [], ["thimphu"]),
  c("maldives", [], ["male"]),
  c("afghanistan", [], ["kabul"]),
  c("china", ["prc"], ["shanghai", "beijing", "shenzhen", "guangzhou", "hangzhou", "chengdu"]),
  c("hong kong", ["hk", "hksar"], ["hong kong"]),
  c("macau", ["macao"], ["macau"]),
  c("taiwan", [], ["taipei", "hsinchu", "taichung"]),
  c("japan", [], ["tokyo", "osaka", "kyoto", "fukuoka", "yokohama"]),
  c("south korea", ["korea", "republic of korea"], ["seoul", "busan", "pangyo"]),
  c("mongolia", [], ["ulaanbaatar"]),
  c("singapore", [], ["singapore"]),
  c("malaysia", [], ["kuala lumpur", "penang", "johor bahru", "cyberjaya"]),
  c("indonesia", [], ["jakarta", "bali", "surabaya", "bandung"]),
  c("thailand", [], ["bangkok", "chiang mai", "phuket"]),
  c("vietnam", ["viet nam"], ["ho chi minh city", "hanoi", "da nang"]),
  c("philippines", [], ["manila", "makati", "taguig", "cebu"]),
  c("cambodia", [], ["phnom penh"]),
  c("laos", [], ["vientiane"]),
  c("myanmar", ["burma"], ["yangon"]),
  c("brunei", [], ["bandar seri begawan"]),
  c("timor leste", ["east timor"], ["dili"]),
  c("kazakhstan", [], ["almaty", "astana"]),
  c("uzbekistan", [], ["tashkent"]),
  c("kyrgyzstan", [], ["bishkek"]),
  c("tajikistan", [], ["dushanbe"]),
  c("turkmenistan", [], ["ashgabat"]),
  // Oceania
  c("australia", [], ["sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra"]),
  c("new zealand", ["nz"], ["auckland", "wellington", "christchurch"]),
  c("fiji", [], ["suva"]),
  c("papua new guinea", ["png"], ["port moresby"]),
  c("samoa", [], ["apia"]),
  c("tonga", [], ["nukualofa"]),
  c("vanuatu", [], ["port vila"]),
  c("solomon islands", [], ["honiara"]),
  // Sub-Saharan Africa
  c("nigeria", [], ["lagos", "abuja", "port harcourt"]),
  c("kenya", [], ["nairobi", "mombasa"]),
  c("south africa", [], ["johannesburg", "cape town", "durban", "pretoria"]),
  c("ghana", [], ["accra", "kumasi"]),
  c("ethiopia", [], ["addis ababa"]),
  c("rwanda", [], ["kigali"]),
  c("uganda", [], ["kampala"]),
  c("tanzania", [], ["dar es salaam", "dodoma", "zanzibar"]),
  c("senegal", [], ["dakar"]),
  c("ivory coast", ["cote d'ivoire", "côte d'ivoire"], ["abidjan"]),
  c("cameroon", [], ["douala", "yaounde"]),
  c("zambia", [], ["lusaka"]),
  c("zimbabwe", [], ["harare"]),
  c("botswana", [], ["gaborone"]),
  c("namibia", [], ["windhoek"]),
  c("mozambique", [], ["maputo"]),
  c("angola", [], ["luanda"]),
  c("mauritius", [], ["port louis", "ebene"]),
  c("madagascar", [], ["antananarivo"]),
  c("malawi", [], ["lilongwe", "blantyre"]),
  c("sudan", [], ["khartoum"]),
  c("south sudan", [], ["juba"]),
  c("somalia", [], ["mogadishu"]),
  c("djibouti", [], ["djibouti"]),
  c("eritrea", [], ["asmara"]),
  c("democratic republic of the congo", ["drc", "dr congo"], ["kinshasa", "lubumbashi"]),
  c("republic of the congo", ["congo"], ["brazzaville"]),
  c("gabon", [], ["libreville"]),
  c("equatorial guinea", [], ["malabo"]),
  c("benin", [], ["cotonou"]),
  c("togo", [], ["lome"]),
  c("burkina faso", [], ["ouagadougou"]),
  c("mali", [], ["bamako"]),
  c("niger", [], ["niamey"]),
  c("chad", [], ["ndjamena"]),
  c("central african republic", [], ["bangui"]),
  c("guinea", [], ["conakry"]),
  c("guinea bissau", [], ["bissau"]),
  c("sierra leone", [], ["freetown"]),
  c("liberia", [], ["monrovia"]),
  c("gambia", [], ["banjul"]),
  c("mauritania", [], ["nouakchott"]),
  c("cape verde", ["cabo verde"], ["praia"]),
  c("burundi", [], ["bujumbura"]),
  c("lesotho", [], ["maseru"]),
  c("eswatini", ["swaziland"], ["mbabane"]),
  c("seychelles", [], ["victoria"]),
  c("comoros", [], ["moroni"]),
  c("sao tome and principe", [], ["sao tome"]),
];

/** Words job ads use for remote or multi-country roles. */
export const REGIONS: Region[] = [
  { name: "emea", aliases: [], hint: "Europe, Middle East & Africa" },
  { name: "mena", aliases: ["middle east"], hint: "Middle East & North Africa" },
  { name: "gcc", aliases: ["gulf"], hint: "Gulf states: UAE, Saudi Arabia, Qatar, Bahrain, Kuwait, Oman" },
  { name: "europe", aliases: ["eu", "european union"], hint: "European countries" },
  { name: "dach", aliases: [], hint: "Germany, Austria, Switzerland" },
  { name: "nordics", aliases: ["scandinavia"], hint: "Sweden, Norway, Denmark, Finland, Iceland" },
  { name: "benelux", aliases: [], hint: "Belgium, Netherlands, Luxembourg" },
  { name: "cee", aliases: ["eastern europe"], hint: "Central & Eastern Europe" },
  { name: "africa", aliases: [], hint: "African countries" },
  { name: "apac", aliases: ["asia pacific"], hint: "Asia-Pacific" },
  { name: "asia", aliases: [], hint: "Asian countries" },
  { name: "south asia", aliases: [], hint: "India, Pakistan, Bangladesh, Sri Lanka…" },
  { name: "southeast asia", aliases: [], hint: "Singapore, Malaysia, Indonesia, Vietnam…" },
  { name: "anz", aliases: [], hint: "Australia & New Zealand" },
  { name: "americas", aliases: ["amer"], hint: "North, Central & South America" },
  { name: "north america", aliases: [], hint: "USA & Canada" },
  { name: "latam", aliases: ["latin america", "south america", "central america"], hint: "Latin America" },
  { name: "worldwide", aliases: ["anywhere", "global"], hint: "Any location" },
];

/** Search hit for the location picker. */
export type PlaceHit = { kind: "country"; country: Country } | { kind: "city"; city: string; country: Country } | { kind: "region"; region: Region };

/** Prefix matches first, then substring; countries before cities before regions on ties. */
export function searchPlaces(query: string, limit = 12): PlaceHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { hit: PlaceHit; score: number }[] = [];
  // Mid-word matches ("uni" in "munich") are noise until the query is long enough to be specific.
  const rank = (s: string) => (s === q ? 0 : s.startsWith(q) ? 1 : s.split(/[\s-]/).some((w) => w.startsWith(q)) ? 2 : q.length >= 4 && s.includes(q) ? 3 : -1);
  for (const country of COUNTRIES) {
    const r = Math.min(...[country.name, ...country.aliases].map(rank).map((x) => (x < 0 ? 9 : x)));
    if (r < 9) scored.push({ hit: { kind: "country", country }, score: r * 10 });
    for (const city of country.cities) {
      const rc = rank(city);
      if (rc >= 0) scored.push({ hit: { kind: "city", city, country }, score: rc * 10 + 1 });
    }
  }
  for (const region of REGIONS) {
    const r = Math.min(...[region.name, ...region.aliases].map(rank).map((x) => (x < 0 ? 9 : x)));
    if (r < 9) scored.push({ hit: { kind: "region", region }, score: r * 10 + 2 });
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => a.score - b.score)
    .map((s) => s.hit)
    .filter((h) => {
      const key = h.kind === "city" ? `city:${h.city}` : h.kind === "country" ? `country:${h.country.name}` : `region:${h.region.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** The match terms a country adds: its name, aliases and (optionally) its cities. */
export function countryTerms(country: Country, withCities: boolean): string[] {
  return [...new Set([country.name, ...country.aliases, ...(withCities ? country.cities : [])])];
}

export type PlaceGroup = {
  /** "country:<name>", "region:<name>" or "term:<term>" */
  key: string;
  kind: "country" | "region" | "term";
  /** Country/region name, or the term itself. */
  name: string;
  /** The group's terms that are currently selected, in their original order. */
  terms: string[];
  /** Every term this group can hold (name, aliases, cities), for expanding into toggles. */
  options: string[];
};

let owners: Map<string, { kind: "country" | "region"; name: string; options: string[] }> | undefined;
function ownerOf(term: string) {
  if (!owners) {
    owners = new Map();
    for (const r of REGIONS) {
      const options = [r.name, ...r.aliases];
      for (const t of options) owners.set(t, { kind: "region", name: r.name, options });
    }
    for (const c of COUNTRIES) {
      const options = countryTerms(c, true);
      for (const t of options) if (!owners.has(t)) owners.set(t, { kind: "country", name: c.name, options });
    }
  }
  return owners.get(term);
}

/**
 * Place names that aren't picker options but contain one ("New South Wales" contains "wales",
 * "New York" contains "york"), with the place they belong to. Used so the longest name wins.
 */
const EXTRA_PLACES: Record<string, string> = {
  "new south wales": "country:australia",
  "new england": "country:united states",
  "new mexico": "country:united states",
  "new jersey": "country:united states",
  "new hampshire": "country:united states",
  "west virginia": "country:united states",
  "new brunswick": "country:canada",
  "british columbia": "country:canada",
  "new caledonia": "term:new caledonia",
  "papua new guinea": "term:papua new guinea",
  "equatorial guinea": "term:equatorial guinea",
};

/**
 * States and provinces, for job locations like "Santa Monica, CA" or "Remote, Ontario". Not picker
 * options: they count for a user who picked the country. Codes are matched only in upper case.
 */
export const SUBDIVISIONS: Record<string, { names: string[]; codes: string[] }> = {
  "united states": {
    names: [
      "alabama",
      "alaska",
      "arizona",
      "arkansas",
      "california",
      "colorado",
      "connecticut",
      "delaware",
      "florida",
      "hawaii",
      "idaho",
      "illinois",
      "indiana",
      "iowa",
      "kansas",
      "kentucky",
      "louisiana",
      "maine",
      "maryland",
      "massachusetts",
      "michigan",
      "minnesota",
      "mississippi",
      "missouri",
      "montana",
      "nebraska",
      "nevada",
      "new hampshire",
      "new jersey",
      "new mexico",
      "north carolina",
      "north dakota",
      "ohio",
      "oklahoma",
      "oregon",
      "pennsylvania",
      "rhode island",
      "south carolina",
      "south dakota",
      "tennessee",
      "texas",
      "utah",
      "vermont",
      "virginia",
      "west virginia",
      "wisconsin",
      "wyoming",
      "district of columbia",
      "new york state",
      "new england",
      "bay area",
      "silicon valley",
    ],
    codes: [
      "AL",
      "AK",
      "AZ",
      "AR",
      "CA",
      "CO",
      "CT",
      "DE",
      "FL",
      "GA",
      "HI",
      "ID",
      "IL",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MS",
      "MO",
      "MT",
      "NE",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "ND",
      "OH",
      "OK",
      "OR",
      "PA",
      "RI",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VT",
      "VA",
      "WA",
      "WV",
      "WI",
      "WY",
      "DC",
    ],
  },
  canada: {
    names: ["ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia", "new brunswick", "newfoundland", "prince edward island"],
    codes: ["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE"],
  },
  australia: {
    names: ["new south wales", "victoria", "queensland", "western australia", "south australia", "tasmania", "australian capital territory"],
    codes: ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT"],
  },
};

/** Which place a term belongs to ("country:united kingdom", "region:latam"), or undefined if unknown. */
export function placeOwner(term: string): string | undefined {
  const t = term.toLowerCase().trim();
  const o = ownerOf(t);
  if (o) return `${o.kind}:${o.name}`;
  if (EXTRA_PLACES[t]) return EXTRA_PLACES[t];
  for (const [country, sub] of Object.entries(SUBDIVISIONS)) if (sub.names.includes(t)) return `country:${country}`;
  return undefined;
}

/** Display name of a place term's owner: "uk" -> "United Kingdom", "Chennai" -> "India". */
export function placeOwnerName(term: string): string | undefined {
  const owner = placeOwner(term);
  if (!owner) return undefined;
  const name = owner.slice(owner.indexOf(":") + 1);
  // Short region codes read as acronyms: "emea" -> "EMEA".
  if (owner.startsWith("region:") && name.length <= 5) return name.toUpperCase();
  return name.replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase());
}

let allNames: string[] | undefined;
/** Every place name we know (countries, aliases, cities, regions, extras), longest first. */
export function allPlaceNames(): string[] {
  allNames ??= [
    ...new Set([
      ...REGIONS.flatMap((r) => [r.name, ...r.aliases]),
      ...COUNTRIES.flatMap((c) => countryTerms(c, true)),
      ...Object.keys(EXTRA_PLACES),
      ...Object.values(SUBDIVISIONS).flatMap((s) => s.names),
    ]),
  ].sort((a, b) => b.length - a.length);
  return allNames;
}

/**
 * Group flat match terms by the country or region they belong to, so the UI can show
 * "United Arab Emirates" as one selection and remove all of its terms together.
 * Terms not in the catalogue stay on their own. Groups keep first-appearance order.
 */
export function groupPlaces(terms: readonly string[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const term of terms) {
    const owner = ownerOf(term);
    const key = owner ? `${owner.kind}:${owner.name}` : `term:${term}`;
    const g = groups.get(key);
    if (g) {
      if (!g.terms.includes(term)) g.terms.push(term);
    } else {
      groups.set(key, owner ? { key, kind: owner.kind, name: owner.name, terms: [term], options: owner.options } : { key, kind: "term", name: term, terms: [term], options: [term] });
    }
  }
  return [...groups.values()];
}

/**
 * Where one location in a job's location text ends and the next begins: "Dubai; London",
 * "SF | NYC", "Berlin or Remote", "Amsterdam (London; Tel Aviv)".
 */
export const LOCATION_SEGMENTS = /[;|/()]|\s+or\s+/i;

/** Two-letter country codes some hiring systems put in the country field ("AE", "GB"). */
const ISO2: Record<string, string> = {
  AE: "united arab emirates",
  SA: "saudi arabia",
  QA: "qatar",
  BH: "bahrain",
  KW: "kuwait",
  OM: "oman",
  JO: "jordan",
  LB: "lebanon",
  EG: "egypt",
  MA: "morocco",
  IL: "israel",
  TR: "turkey",
  CY: "cyprus",
  GB: "united kingdom",
  UK: "united kingdom",
  IE: "ireland",
  FR: "france",
  DE: "germany",
  NL: "netherlands",
  BE: "belgium",
  LU: "luxembourg",
  CH: "switzerland",
  AT: "austria",
  ES: "spain",
  PT: "portugal",
  IT: "italy",
  MT: "malta",
  GR: "greece",
  SE: "sweden",
  NO: "norway",
  DK: "denmark",
  FI: "finland",
  EE: "estonia",
  LV: "latvia",
  LT: "lithuania",
  PL: "poland",
  CZ: "czech republic",
  SK: "slovakia",
  HU: "hungary",
  RO: "romania",
  BG: "bulgaria",
  RS: "serbia",
  HR: "croatia",
  SI: "slovenia",
  UA: "ukraine",
  GE: "georgia",
  AM: "armenia",
  US: "united states",
  CA: "canada",
  MX: "mexico",
  BR: "brazil",
  AR: "argentina",
  CL: "chile",
  CO: "colombia",
  PE: "peru",
  UY: "uruguay",
  IN: "india",
  PK: "pakistan",
  CN: "china",
  HK: "hong kong",
  TW: "taiwan",
  JP: "japan",
  KR: "south korea",
  SG: "singapore",
  MY: "malaysia",
  ID: "indonesia",
  TH: "thailand",
  VN: "vietnam",
  PH: "philippines",
  AU: "australia",
  NZ: "new zealand",
  NG: "nigeria",
  KE: "kenya",
  ZA: "south africa",
};

let countryPattern: RegExp | undefined;
/** Every country name, alias, city and state, as one pattern (longest first, so "New South Wales" beats "wales"). */
function countryNamePattern(): RegExp {
  if (!countryPattern) {
    const names = allPlaceNames().filter((n) => placeOwner(n)?.startsWith("country:"));
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
    countryPattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  }
  return countryPattern;
}
let codePattern: RegExp | undefined;
function subdivisionCodePattern(): RegExp {
  if (!codePattern) {
    const parts = Object.entries(SUBDIVISIONS).flatMap(([country, s]) => s.codes.map((code) => [code, country] as const));
    codePattern = new RegExp(`(?:,\\s*|\\()(${[...new Set(parts.map(([c]) => c))].join("|")})(?![\\p{L}])`, "gu");
  }
  return codePattern;
}
let cities: Set<string> | undefined;
const cityNames = () => (cities ??= new Set(COUNTRIES.flatMap((c) => c.cities)));

const CODE_OWNER = new Map<string, string>();
for (const [country, s] of Object.entries(SUBDIVISIONS)) for (const code of s.codes) if (!CODE_OWNER.has(code)) CODE_OWNER.set(code, country);

/**
 * Countries a job's location names, as display names ("Dubai, UAE" -> ["United Arab Emirates"],
 * "San Jose, CA" -> ["United States"]). `country` is the hiring system's own field, if any.
 */
export function countriesIn(location: string, country?: string): string[] {
  // A city is weak evidence ("San Jose" is also in Costa Rica, "London" also in Ontario): it only
  // counts when nothing in the location names a country, alias, state or code outright.
  // Judged per segment, so "Dubai; London, UK" keeps both.
  const pretty = (name: string) => name.replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase());
  const found = new Set<string>();
  const text = location.replace(/\bU\.S\.A?\.?/g, "USA").replace(/\bU\.K\.?/g, "UK");
  for (const segment of text.split(LOCATION_SEGMENTS)) {
    const strong = new Set<string>();
    const weak = new Set<string>();
    for (const m of segment.matchAll(countryNamePattern())) {
      const name = m[0].toLowerCase().replace(/[\s-]+/g, " ");
      const owner = placeOwner(name)?.slice(8);
      if (owner) (cityNames().has(name) ? weak : strong).add(owner);
    }
    for (const m of segment.matchAll(subdivisionCodePattern())) strong.add(CODE_OWNER.get(m[1]!)!);
    for (const c of strong.size ? strong : weak) found.add(pretty(c));
  }
  const code = country?.trim();
  if (code && ISO2[code.toUpperCase()]) found.add(pretty(ISO2[code.toUpperCase()]!));
  else if (code) for (const m of code.matchAll(countryNamePattern())) found.add(pretty(placeOwner(m[0].toLowerCase())?.slice(8) ?? m[0]));
  return [...found];
}

/** Spellings of the same city that job ads use. */
const CITY_ALIASES: Record<string, string> = {
  nyc: "new york",
  "new york city": "new york",
  "new york ny": "new york",
  manhattan: "new york",
  brooklyn: "new york",
  sf: "san francisco",
  "san francisco bay area": "san francisco",
  "sf bay area": "san francisco",
  "bay area": "san francisco",
  "washington dc": "washington dc",
  "washington d c": "washington dc",
  "district of columbia": "washington dc",
  bengaluru: "bangalore",
  "greater london": "london",
  "city of london": "london",
};

/**
 * Names for the same place, so picking one finds the others ("dubai" finds "DXB"). Hand-curated;
 * GeoNames (CC BY 4.0) is the place to extend it from offline later, with attribution.
 * An upper-case entry is only read in capitals and never as a state code after a comma
 * ("LA" is Los Angeles, "New Orleans, LA" is Louisiana).
 */
export const PLACE_ALIASES: string[][] = [
  ["san francisco", "sf", "san francisco bay area", "sf bay area", "bay area"],
  ["new york", "nyc", "new york city"],
  ["los angeles", "LA"],
  ["washington dc", "dc", "washington d c", "district of columbia"],
  ["bangalore", "bengaluru"],
  ["mumbai", "bombay"],
  ["gurgaon", "gurugram"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["delhi", "new delhi"],
  ["dubai", "dxb"],
  ["abu dhabi", "auh"],
  ["saudi arabia", "ksa"],
  ["united arab emirates", "uae"],
  ["united kingdom", "uk", "great britain", "britain", "gb"],
  ["united states", "usa", "us", "united states of america"],
  ["ho chi minh city", "saigon"],
  ["zurich", "zürich"],
  ["munich", "münchen"],
  ["cologne", "köln"],
];

/** Parts a place always includes: picking the UK also finds "England". */
const PLACE_PARTS: Record<string, string[]> = {
  "united kingdom": ["england", "scotland", "wales", "northern ireland"],
};

/** Your place terms plus their other names ("sf" -> "san francisco", "bay area"…). Upper-case-only names stay out. */
export function expandPlaces(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    out.add(t);
    const group = PLACE_ALIASES.find((g) => g.includes(t));
    for (const name of group ?? []) {
      if (name !== name.toUpperCase()) out.add(name);
      for (const part of PLACE_PARTS[name] ?? []) out.add(part);
    }
  }
  return [...out];
}

const SHORT_NAMES = PLACE_ALIASES.flatMap((g) => g.filter((n) => n === n.toUpperCase()).map((n) => [new RegExp(`(?<!,\\s*)\\b${n}\\b`, "g"), g[0]!] as const));

/** Spell out upper-case-only place names in a job's location: "LA / SF" -> "los angeles / SF". */
export function spellOutPlaces(location: string): string {
  let s = location;
  for (const [re, name] of SHORT_NAMES) s = s.replace(re, name);
  return s;
}

/** Wording in a location that isn't a place. */
const NOT_A_PLACE =
  /\b(fully|remote|remotely|hybrid|office|offices|hq|headquarters|on-?site|onsite|in-?office|within|only|based|any|anywhere|time ?zones?|zone|flexible|first|friendly|travel|required|job|requisitions?|location|locations|multiple|various|global|worldwide|roles?)\b/gi;

const titleCase = (s: string) => s.replace(/(^|[\s-])\p{L}/gu, (ch) => ch.toUpperCase());

let notCity: Set<string> | undefined;
/** Names that are countries, aliases, regions or states: never a city on their own. */
function notCityNames(): Set<string> {
  if (!notCity) {
    notCity = new Set([
      ...REGIONS.flatMap((r) => [r.name, ...r.aliases]),
      ...COUNTRIES.flatMap((c) => [c.name, ...c.aliases]),
      ...Object.values(SUBDIVISIONS).flatMap((s) => [...s.names, ...s.codes.map((x) => x.toLowerCase())]),
      ...Object.keys(ISO2).map((x) => x.toLowerCase()),
      "usa",
      "us",
      "uk",
      "uae",
      "emea",
      "apac",
      "amer",
      "americas",
      "latam",
      "remote",
      "europe",
    ]);
  }
  return notCity;
}

let regionPattern: RegExp | undefined;
/** "Middle East North Africa", "Roles EMEA": a region, not a city. */
function isRegionPhrase(name: string): boolean {
  if (!regionPattern) {
    const names = [...REGIONS.flatMap((r) => [r.name, ...r.aliases]), "north africa", "middle east", "asia pacific", "sub saharan africa"];
    regionPattern = new RegExp(`(?<![\\p{L}])(?:${names.map((n) => n.replace(/\s+/g, "[\\s-]+")).join("|")})(?![\\p{L}])`, "iu");
  }
  return regionPattern.test(name);
}

let cityPattern: RegExp | undefined;
function catalogueCityPattern(): RegExp {
  if (!cityPattern) {
    const names = [...new Set([...COUNTRIES.flatMap((c) => c.cities), ...Object.keys(CITY_ALIASES)])].sort((a, b) => b.length - a.length);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s.-]+");
    cityPattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "iu");
  }
  return cityPattern;
}

/**
 * Cities a job's location names, as "City, Country" when the country is known
 * ("USA - New York" -> ["New York, United States"], "Dubai; London, UK" -> two entries).
 * Countries, regions, states and remote wording on their own give no city.
 */
export function citiesIn(location: string): string[] {
  const found = new Set<string>();
  const text = location
    .replace(/\bU\.S\.A?\.?/g, "USA")
    .replace(/\bU\.K\.?/g, "UK")
    .replace(/\bD\.C\.?/g, "DC")
    .replace(/\bWashington,?\s+DC\b/gi, "Washington DC");
  // A segment that names no country borrows the location's, when the whole location names just one.
  const only = countriesIn(location);
  const fallback = only.length === 1 ? only[0] : undefined;
  for (const segment of text.split(LOCATION_SEGMENTS)) {
    const country = countriesIn(segment)[0] ?? fallback;
    // Code prefixes like "US-CA-Menlo Park", "USA - New York", "US California (Redwood City)", "The Netherlands".
    const cleaned = segment
      .replace(/^\s*[A-Z]{2,3}(?:-[A-Z]{2})?-(?=\S)/, "")
      .replace(/^\s*(?:USA|US|UK|UAE)\b[\s,:–-]*/i, "")
      .replace(/^\s*the\s+/i, "");
    let city: string | undefined;
    const known = cleaned.match(catalogueCityPattern())?.[0];
    if (known) city = known.toLowerCase().replace(/[\s.-]+/g, " ");
    else {
      for (const part of cleaned.split(/[,(]/)) {
        const name = part
          .replace(NOT_A_PLACE, " ")
          .replace(/[^\p{L}\s'.-]/gu, " ")
          .replace(/\s+/g, " ")
          .replace(/^[\s.-]+|[\s.-]+$/g, "")
          .toLowerCase();
        if (name.length < 3 || notCityNames().has(name) || isRegionPhrase(name)) continue;
        city = name;
        break;
      }
    }
    if (!city) continue;
    city = CITY_ALIASES[city] ?? city;
    if (notCityNames().has(city)) continue;
    const display = city === "washington dc" ? "Washington DC" : titleCase(city);
    found.add(country ? `${display}, ${country}` : display);
  }
  return [...found];
}
