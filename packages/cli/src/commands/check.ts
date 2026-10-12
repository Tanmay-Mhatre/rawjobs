import { parseArgs } from "node:util";
import { connectors, detectCompany, loadConfig, isLegacyConfig } from "@rawjobs/core";

export function cmdDetect(urls: string[]): number {
  if (!urls.length) {
    console.error("Usage: rawjobs detect <careers-url> [more urls...]");
    return 2;
  }
  let failures = 0;
  for (const u of urls) {
    const c = detectCompany(u);
    if (!c) {
      console.error(`# could not detect an ATS for ${u} (supported so far: ${Object.keys(connectors).join(", ")})`);
      failures++;
      continue;
    }
    if (!c.supported) console.error(`# ${c.ats} is recognised but not fetched yet; this line will start working when its connector ships`);
    const extra = [c.region && `region: ${c.region}`, c.shard && `shard: "${c.shard}"`, c.site && `site: "${c.site}"`]
      .filter(Boolean)
      .map((s) => `, ${s}`)
      .join("");
    console.log(`  - { name: "${c.name}", ats: ${c.ats}, slug: "${c.slug}"${extra} }`);
  }
  return failures ? 1 : 0;
}

export function cmdValidate(args: string[]): number {
  const { values } = parseArgs({ args, options: { config: { type: "string", short: "c" } } });
  const { config, path } = loadConfig(values.config);
  const byAts = new Map<string, number>();
  for (const c of config.companies) byAts.set(c.ats, (byAts.get(c.ats) ?? 0) + 1);
  const unsupported = config.companies.filter((c) => !connectors[c.ats]);
  console.log(`✓ ${path} is valid`);
  if (isLegacyConfig(path)) console.log(`  note: rename it to ${path.replace("jobhunter.config", "rawjobs.config")}; the old name still works for now`);
  console.log(`  profile: ${config.profile.name}, min_score ${config.profile.min_score}, ${Object.keys(config.profile.keywords).length} keywords`);
  console.log(`  companies: ${config.companies.length} (${[...byAts].map(([a, n]) => `${a} ${n}`).join(", ")})`);
  if (unsupported.length) {
    console.log(`  note: no connector yet for ${unsupported.map((c) => `${c.name} (${c.ats})`).join(", ")}; they're kept and will start working when support ships`);
  }
  return 0;
}
