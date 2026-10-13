/**
 * Wikidata (CC0) as an industry source: a company's "industry" statements (P452), mapped to our
 * industry ids, and how a Wikidata company is matched to a directory company. No AI: a fixed table
 * of Wikidata items, and exact name + website matches.
 */

/**
 * Wikidata industry items -> our industry ids. Only items that clearly mean one of ours; broad ones
 * ("software industry", "financial services") are in BROAD and count only when nothing more specific
 * does. Items left out (petroleum, mining, conglomerate, "information technology", "technology", …)
 * have no industry of ours that fits them. Taken from the industries the ~18k companies seeds-bulk.ts
 * reads use most often.
 */
export const WIKIDATA_INDUSTRIES: Record<string, string[]> = {
  // Software & internet
  Q1254596: ["saas"], // software as a service
  Q1318054: ["saas"], // enterprise software
  Q485643: ["saas"], // customer relationship management
  Q880371: ["saas"], // software industry (broad)
  Q638608: ["saas"], // software development (broad)
  Q123131138: ["saas"], // Software Publishers (broad)
  Q112165934: ["saas"], // publishing of application software (broad)
  Q29585678: ["saas"], // computer programming activities (broad)
  Q112165968: ["saas"], // computer programming (broad)
  Q11660: ["ai"], // artificial intelligence
  Q485396: ["data"], // analytics
  Q3353185: ["data"], // business intelligence
  Q483639: ["cloud"], // cloud computing
  Q5892272: ["cloud"], // web hosting service
  Q1210425: ["cloud"], // internet hosting service
  Q112165979: ["cloud"], // data processing, hosting and related activities
  Q3510521: ["cybersecurity"], // computer security
  Q189900: ["cybersecurity"], // information security
  Q484847: ["ecommerce"], // e-commerce
  Q3390477: ["ecommerce"], // online marketplace
  Q4382945: ["ecommerce"], // online shop
  Q425779: ["ecommerce"], // mail order
  Q10932402: ["ecommerce", "food"], // food delivery
  Q37038: ["marketing"], // advertising
  Q39809: ["marketing"], // marketing
  Q1323528: ["marketing"], // digital marketing
  Q1155133: ["marketing"], // email marketing
  Q624902: ["marketing"], // online advertising
  Q133889840: ["marketing"], // marketing technology
  Q97466017: ["marketing"], // marketing software industry
  Q382453: ["marketing"], // affiliate marketing
  Q189507: ["marketing"], // internet marketing
  Q23700481: ["marketing"], // advertising industry
  Q133080: ["marketing"], // public relations
  Q913709: ["marketing"], // market research
  Q11033: ["media"], // mass media
  Q3972943: ["media"], // publishing
  Q16023725: ["media"], // publishing industry
  Q56611639: ["media"], // media industry
  Q1415395: ["media"], // film industry
  Q932586: ["media"], // film production
  Q19595701: ["media"], // entertainment industry
  Q173799: ["media"], // entertainment
  Q15078788: ["media"], // broadcasting
  Q746359: ["media"], // music industry
  Q638: ["media"], // music
  Q10302058: ["media"], // phonographic industry
  Q289: ["media"], // television
  Q175122: ["media"], // terrestrial television
  Q184452: ["media"], // cable television
  Q721830: ["media"], // subscription television
  Q1407228: ["media"], // television production
  Q872: ["media"], // radio
  Q220499: ["media"], // streaming media
  Q1193236: ["media"], // news media
  Q11030: ["media"], // journalism
  Q11425: ["media"], // animation
  Q941594: ["gaming"], // video game industry
  Q1368944: ["gaming"], // game industry
  Q1068473: ["edtech"], // educational technology
  Q11499366: ["edtech"], // education industry
  Q8434: ["edtech"], // education
  Q63348704: ["hrtech"], // employment services industry
  Q1056396: ["hrtech"], // human resource management
  Q899277: ["hrtech"], // recruitment
  // Financial services
  Q16319025: ["fintech"], // fintech
  Q837171: ["fintech"], // financial services (broad)
  Q57774188: ["fintech"], // financial sector (broad)
  Q43015: ["fintech"], // finance (broad)
  Q29584334: ["fintech"], // financial service activities, except insurance and pension funding (broad)
  Q29585697: ["fintech"], // other financial service activities n.e.c. (broad)
  Q29585710: ["fintech"], // activities auxiliary to financial services (broad)
  Q1956140: ["payments"], // payment service provider
  Q806718: ["banking"], // economics of banking
  Q22687: ["banking"], // bank
  Q3435731: ["banking"], // banking
  Q96107414: ["banking"], // commercial banking industry
  Q96107484: ["banking"], // development banking industry
  Q319845: ["banking"], // investment bank
  Q29585689: ["banking"], // other monetary intermediation
  Q112165989: ["banking"], // other monetary intermediations
  Q1941439: ["digital-bank"], // mobile banking
  Q96107489: ["lending"], // microfinance industry
  Q29585695: ["lending"], // other credit granting
  Q29585694: ["lending"], // financial leasing
  Q873442: ["wealth"], // asset management
  Q14864997: ["wealth"], // investment management
  Q476115: ["wealth"], // private equity
  Q4290: ["wealth"], // investment
  Q1752459: ["wealth"], // investment company
  Q43183: ["insurtech"], // insurance
  Q2518196: ["insurtech"], // insurance industry
  Q2143354: ["insurtech"], // insurance company
  Q626608: ["insurtech"], // life insurance
  Q334911: ["insurtech"], // health insurance
  Q29585701: ["insurtech"], // non-life insurance
  Q2663825: ["insurtech"], // general insurance
  Q100269062: ["crypto"], // cryptocurrency industry
  Q29585707: ["brokerage"], // security and commodity contracts brokerage
  Q29585706: ["trading-tech"], // administration of financial markets
  // Health & life sciences
  Q31207: ["healthtech"], // health care
  Q15067276: ["healthtech"], // health care industry
  Q12147: ["healthtech"], // health
  Q10910281: ["healthtech"], // health information technology
  Q130370834: ["healthtech"], // hospitals and rehabilitation
  Q1416012: ["healthtech"], // managed care
  Q29585987: ["healthtech"], // general medical practice activities
  Q13107184: ["healthtech"], // pharmacy
  Q507443: ["biotech"], // pharmaceutical industry
  Q29584494: ["biotech"], // manufacture of pharmaceutical preparations
  Q7108: ["biotech"], // biotechnology
  Q12303494: ["biotech"], // biotechnology industry
  Q63383285: ["biotech"], // medical technology industry
  Q1519843: ["biotech"], // medical technology
  Q6554101: ["biotech"], // medical device
  Q327092: ["biotech"], // biomedical engineering
  // Industry, energy & transport
  Q2151621: ["climate"], // energy industry
  Q1304795: ["climate"], // energy sector
  Q1341477: ["climate"], // energy supply
  Q1341478: ["climate"], // energy company
  Q2316331: ["climate"], // electric power industry
  Q1326594: ["climate"], // electric power generation, transmission and distribution
  Q383973: ["climate"], // electricity generation
  Q112128860: ["climate"], // electric power production
  Q1326624: ["climate"], // electricity supply company
  Q2356921: ["climate"], // trade of electricity
  Q48767813: ["climate"], // renewable energy industry
  Q12705: ["climate"], // renewable energy
  Q192127: ["climate"], // photovoltaics
  Q8024050: ["climate"], // wind power industry
  Q96107472: ["climate"], // hydro power industry
  Q80638: ["climate"], // hydroelectricity
  Q4072210: ["climate"], // nuclear industry
  Q99529212: ["climate"], // battery industry
  Q278784: ["climate"], // district heating
  Q743030: ["climate"], // environmental technology
  Q132580: ["climate"], // recycling
  Q5358497: ["hardware"], // electronics industry
  Q11650: ["hardware"], // electronics
  Q73768396: ["hardware"], // consumer electronics industry
  Q2986369: ["hardware"], // semiconductor industry
  Q11456: ["hardware"], // semiconductor
  Q132898730: ["hardware"], // computer hardware industry
  Q1067601: ["hardware"], // computer industry
  Q66221: ["hardware"], // computer storage media
  Q56598901: ["hardware"], // mobile phone industry
  Q170978: ["robotics"], // robotics
  Q184199: ["robotics"], // automation
  Q8148: ["manufacturing"], // industry
  Q187939: ["manufacturing"], // industrial manufacturing
  Q10861389: ["manufacturing"], // manufacturing industry
  Q207652: ["manufacturing"], // chemical industry
  Q96472399: ["manufacturing"], // basic industry and chemicals sector
  Q16070574: ["manufacturing"], // petrochemical industry
  Q101333: ["manufacturing"], // mechanical engineering
  Q1957908: ["manufacturing"], // manufacture of machinery and equipment
  Q107597925: ["manufacturing"], // machinery industry and plant construction
  Q107598010: ["manufacturing"], // precision engineering and optical industry
  Q1326885: ["manufacturing"], // electrical industry
  Q2285982: ["manufacturing"], // iron and steel industry
  Q1924906: ["manufacturing"], // metal industry
  Q4063722: ["manufacturing"], // aluminium industry
  Q11467: ["manufacturing"], // metallurgy
  Q1048894: ["manufacturing"], // non-ferrous metallurgy
  Q953045: ["manufacturing"], // metalworking
  Q607081: ["manufacturing"], // textile industry
  Q56604576: ["manufacturing"], // packaging industry
  Q117156504: ["manufacturing"], // product packaging industry
  Q2283886: ["manufacturing"], // pulp and paper industry
  Q335415: ["manufacturing"], // papermaking
  Q107598157: ["manufacturing"], // plastics and rubber industry
  Q770899: ["manufacturing"], // light industry
  Q622662: ["manufacturing"], // heavy industry
  Q11990434: ["manufacturing"], // furniture industry
  Q26897133: ["manufacturing"], // printing industry
  Q1327701: ["manufacturing"], // power tool
  Q474200: ["manufacturing"], // shipbuilding
  Q190117: ["automotive"], // automotive industry
  Q3477381: ["automotive"], // automotive supplier
  Q124192: ["automotive"], // automotive engineering
  Q107597958: ["automotive"], // vehicle construction
  Q56598570: ["automotive"], // motorcycle industry
  Q786803: ["automotive"], // car dealership
  Q169545: ["automotive"], // tire
  Q3477363: ["aerospace"], // aerospace industry
  Q3798668: ["aerospace"], // aerospace engineering
  Q1875606: ["aerospace"], // aircraft industry
  Q1434048: ["aerospace"], // aircraft construction
  Q2729047: ["aerospace"], // space industry
  Q392933: ["aerospace"], // weapons industry
  Q16955053: ["aerospace"], // defence industry
  Q2401742: ["telecom"], // telecommunications industry
  Q418: ["telecom"], // telecommunications
  Q11371: ["telecom"], // internet service provider
  Q62058278: ["telecom"], // network operator
  Q1301371: ["telecom"], // computer network
  Q1546066: ["telecom"], // networking hardware
  Q2225985: ["telecom"], // satellite communication
  Q7590: ["mobility"], // transport
  Q2516512: ["mobility"], // transport industry
  Q178512: ["mobility"], // public transport
  Q2072431: ["mobility"], // passenger transport
  Q3565868: ["mobility"], // rail transport
  Q22667: ["mobility"], // railway
  Q10302057: ["mobility"], // rail industry
  Q2995256: ["mobility"], // rail vehicle manufacturer
  Q4265939: ["mobility"], // locomotive manufacturing
  Q765633: ["mobility"], // aviation
  Q1757562: ["mobility"], // air transport
  Q1248784: ["mobility"], // airport
  Q17018236: ["mobility"], // bicycle industry
  Q177777: ["logistics"], // logistics
  Q651658: ["logistics"], // freight transport
  Q2234623: ["logistics"], // rail freight transport
  Q29584313: ["logistics"], // water transport
  Q1807108: ["logistics"], // shipping line
  Q49845: ["logistics"], // mail
  Q1529128: ["logistics"], // postal service
  Q1447463: ["logistics"], // package delivery
  Q867147: ["logistics"], // product distribution
  Q112165880: ["logistics"], // auxiliary land transport services
  Q3875186: ["construction"], // construction
  Q13405640: ["construction"], // construction industry
  Q73303844: ["construction"], // civil engineering
  Q2674423: ["construction"], // construction engineering
  Q29585433: ["construction"], // construction of roads and motorways
  Q112122737: ["construction"], // construction of residential and non-residential buildings
  Q1799415: ["construction"], // house-building
  Q206615: ["construction"], // building material
  Q12144907: ["construction"], // construction materials industry
  Q811891: ["construction"], // building materials trade
  Q96472425: ["construction"], // infrastructure industry
  Q1798773: ["construction"], // heating, ventilation, and air conditioning
  Q12271: ["construction"], // architecture
  Q11451: ["agriculture"], // agriculture
  Q396622: ["agriculture"], // agribusiness
  Q1347753: ["agriculture"], // industrial agriculture
  Q188989: ["agriculture"], // aquaculture
  Q635139: ["agriculture"], // fishing industry
  Q38112: ["agriculture"], // forestry
  // Consumer, retail & travel
  Q126793: ["retail"], // retail
  Q136954271: ["retail"], // retail industry
  Q507619: ["retail"], // retail chain
  Q7361709: ["retail"], // convenience store
  Q216107: ["retail"], // department store
  Q1260046: ["retail"], // drugstore
  Q15825471: ["retail"], // food retail sector
  Q29585561: ["retail"], // retail sale in non-specialised stores (food)
  Q29585564: ["retail"], // other retail sale in non-specialised stores
  Q29585583: ["retail"], // retail sale of hardware, paints and glass
  Q56573357: ["retail"], // consumer goods industry
  Q1187656: ["retail"], // fast-moving consumer goods
  Q11828862: ["retail"], // clothing industry
  Q12684: ["retail"], // fashion
  Q3231404: ["retail"], // fast fashion
  Q5915560: ["retail"], // footwear industry
  Q12752882: ["retail"], // cosmetics industry
  Q3246832: ["retail"], // personal care product
  Q161439: ["retail"], // jewelry
  Q41767: ["retail"], // horology
  Q212920: ["retail"], // home appliance
  Q56604188: ["retail"], // home appliance industry
  Q907703: ["retail"], // tobacco industry
  Q540912: ["food"], // food industry
  Q627371: ["food"], // food processing
  Q107601756: ["food"], // food and tobacco industry
  Q4899370: ["food"], // beverage industry
  Q3150593: ["food"], // alcohol industry
  Q11644505: ["food"], // brewing industry
  Q213376: ["food"], // winemaking
  Q41958: ["food"], // food service
  Q1751445: ["food"], // system catering
  Q11707: ["food"], // restaurant
  Q104714944: ["food"], // restaurant industry
  Q18534542: ["food"], // restaurant chain
  Q81799: ["food"], // fast food
  Q171141: ["food"], // gastronomy
  Q274393: ["food"], // bakery
  Q4498099: ["food"], // bakery industry
  Q29584437: ["food"], // manufacture of bakery and farinaceous products
  Q18646422: ["food"], // confectionery
  Q637776: ["food"], // dairy
  Q13554450: ["food"], // dairy industry
  Q955043: ["food"], // meatpacking industry
  Q227870: ["food"], // manufacture of sugar
  Q49389: ["travel"], // tourism
  Q9323634: ["travel"], // tourism industry
  Q1495452: ["travel"], // hospitality industry
  Q27686: ["travel"], // hotel
  Q1285245: ["travel"], // hotel industry
  Q1631129: ["travel"], // hotel chain
  Q1423777: ["travel"], // travel industry
  Q61509: ["travel"], // travel
  Q217107: ["travel"], // travel agency
  Q376880: ["travel"], // air travel
  Q59308842: ["travel"], // leisure park industry
  Q1660132: ["proptech"], // real estate industry
  Q1660104: ["proptech"], // real estate company
  Q695829: ["proptech"], // real estate development
  Q697852: ["proptech"], // real estate investment trust
  Q10494269: ["proptech"], // real property
  Q1618728: ["proptech"], // property management
  Q112122784: ["proptech"], // renting and operating of own or leased real estate
  Q11416: ["betting"], // gambling
  Q61054412: ["betting"], // gambling industry
  Q3550859: ["betting"], // online gambling
  Q1506462: ["betting"], // sports betting
  Q770881: ["betting"], // online casino
  Q189409: ["betting"], // lottery
  Q4438117: ["sports"], // sports industry
  Q768186: ["sports"], // sports equipment
  // Professional & public services
  Q1540863: ["consulting"], // information technology consulting
  Q130286: ["consulting"], // business and other management consultancy activities
  Q23699878: ["consulting"], // management consulting industry
  Q63769412: ["consulting"], // consulting
  Q2089936: ["consulting"], // consulting company
  Q268626: ["consulting"], // consultation
  Q23700345: ["consulting"], // professional services industry
  Q2029911: ["consulting"], // professional service
  Q23931362: ["legal"], // legal tech
  Q613142: ["legal"], // law firm
  Q1494322: ["legal"], // legal services
  Q1063076: ["nonprofit"], // voluntary sector
};

/** Items so broad that a more specific one, when the company has it, says more ("bank" over "financial services"). */
const BROAD = new Set(["Q880371", "Q638608", "Q123131138", "Q112165934", "Q29585678", "Q112165968", "Q837171", "Q57774188", "Q43015", "Q29584334", "Q29585697", "Q29585710"]);

/** Our industry ids for a company's Wikidata industry items (Q-ids). Unknown items are ignored. */
export function industriesForWikidata(items: readonly string[]): string[] {
  const specific = new Set(items.filter((q) => !BROAD.has(q)).flatMap((q) => WIKIDATA_INDUSTRIES[q] ?? []));
  const ids = specific.size ? specific : new Set(items.flatMap((q) => WIKIDATA_INDUSTRIES[q] ?? []));
  return [...ids].sort();
}

/** A company name, compared without case, accents, punctuation or legal suffixes ("Acme, Inc." = "ACME"). */
export function plainName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|co|company|gmbh|ag|sa|se|nv|bv|ab|asa|oyj|spa|group|holdings?)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/** The name part of a website's domain ("https://www.corporate.visa.com/x" -> "visa", "nib.com.au" -> "nib"). */
export function domainLabel(website: string): string {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase();
  } catch {
    return "";
  }
  const parts = host.replace(/^www\d?\./, "").split(".");
  if (parts.length < 2) return "";
  // A second-level label under a country code ("co.uk", "com.au") isn't the name.
  const i = parts.length >= 3 && /^(co|com|net|org|ac|gov|or|ne)$/.test(parts[parts.length - 2]!) ? parts.length - 3 : parts.length - 2;
  return parts[i]!.replace(/[^a-z0-9]/g, "");
}

/**
 * Whether a directory board is this Wikidata company's: the same name, and a board id that is the
 * website's name ("visa" for visa.com; "hubspotjobs" for hubspot.com). A shared name alone isn't
 * enough ("Cedar" the health-payments startup isn't "Cedar" of cedar-web.com).
 */
export function boardMatchesWebsite(board: { slug: string }, website: string): boolean {
  const label = domainLabel(website);
  if (label.length < 4) return false;
  // Boards on the company's own domain (career sites) carry the host as their id.
  if (board.slug.includes(".")) return domainLabel(board.slug) === label;
  const slug = board.slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const core = slug.replace(/(careers?|jobs?|group|inc|hq|corp|global|\d+)+$/, "");
  return slug === label || core === label;
}
