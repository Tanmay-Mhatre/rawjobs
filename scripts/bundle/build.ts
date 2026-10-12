import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { changelogFromTags, readTags } from "../release/changelog";

/**
 * Build the copy of RawJobs that gets installed: it needs only Node, no pnpm or tsx.
 *   cli.mjs        the CLI and the dashboard's server, with every dependency (`node cli.mjs serve`)
 *   web/           the built dashboard
 *   bin/           the launchers (copied into the install's own bin/)
 *   package.json   the version
 *   changelog.json every release's notes up to this version, from the git tags (scripts/release/changelog.ts)
 *
 *   pnpm bundle                 → dist/bundle/rawjobs-<version>/
 *   pnpm bundle --skip-web      reuse apps/web/dist as it is
 *   pnpm bundle --version <v>   label it as another version (update tests); --broken: one that can't start
 *   pnpm bundle --try <dir>     also lay it out as an installed copy in <dir> (bin/, app/, runtime/
 *                               with this computer's Node) to try the launcher: <dir>/bin/rawjobs serve
 */
const root = resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: { "skip-web": { type: "boolean", default: false }, try: { type: "string" }, version: { type: "string" }, broken: { type: "boolean", default: false } },
});

const version = values.version ?? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const out = join(root, "dist/bundle", `rawjobs-${version}`);

if (!values["skip-web"]) run("pnpm", ["build"]);
if (!existsSync(join(root, "apps/web/dist/index.html"))) fail("apps/web/dist is missing: run without --skip-web.");
// The bundle is shipped to other people: never with anyone's own jobs, profile or scan data in it.
for (const personal of ["jobs.json", "meta.json", "history.json", "catalog", "runs", "profile"]) {
  if (existsSync(join(root, "apps/web/dist", personal))) fail(`apps/web/dist/${personal} is run data, not part of the dashboard. Delete apps/web/dist and build again.`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const started = Date.now();
await build({
  entryPoints: [join(root, "packages/cli/src/index.ts")],
  outfile: join(out, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Tells the code it runs from the bundle (packages/core/src/runtime.ts), and which version it is (http.ts).
  define: { __RAWJOBS_BUNDLE__: "true", __RAWJOBS_VERSION__: JSON.stringify(version) },
  // Some dependencies still call require(); give the ES module one.
  banner: { js: 'import { createRequire as __rawjobsRequire } from "node:module"; const require = __rawjobsRequire(import.meta.url);' },
  legalComments: "linked",
  logLevel: "warning",
});

// Update tests: a version that fails at once, so the update has to go back.
if (values.broken) writeFileSync(join(out, "cli.mjs"), 'console.error("This test build never starts."); process.exit(3);\n');
cpSync(join(root, "apps/web/dist"), join(out, "web"), { recursive: true });
cpSync(join(root, "packaging/bin"), join(out, "bin"), { recursive: true });
chmodSync(join(out, "bin/rawjobs"), 0o755);
writeFileSync(join(out, "package.json"), `${JSON.stringify({ name: "rawjobs", version, type: "module", license: "MIT" }, null, 2)}\n`);
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));
// What's new in each version, for the dashboard (a checkout without tags ships an empty one).
writeFileSync(
  join(out, "changelog.json"),
  `${JSON.stringify(changelogFromTags(readTags(root), version), null, 1)}
`,
);

const mb = (statSync(join(out, "cli.mjs")).size / 1e6).toFixed(1);
console.log(`Bundled RawJobs ${version} in ${Date.now() - started} ms: ${out} (cli.mjs ${mb} MB)`);

if (values.try) tryInstall(resolve(values.try));

/**
 * Lay the bundle out the way an install does (docs/plans/local-install.md, section 2), using this
 * computer's Node as the runtime. Your config, profile/ and data/ in that folder are left alone.
 */
function tryInstall(home: string) {
  const nodeName = `node-${process.version}-${process.platform}-${process.arch}`;
  const nodeDir = join(home, "runtime", nodeName);
  const nodeTarget = process.platform === "win32" ? join(nodeDir, "node.exe") : join(nodeDir, "bin/node");
  if (!existsSync(nodeTarget)) {
    mkdirSync(dirname(nodeTarget), { recursive: true });
    copyFileSync(process.execPath, nodeTarget);
    chmodSync(nodeTarget, 0o755);
  }
  writeFileSync(join(home, "runtime/current.txt"), nodeName);

  const app = join(home, "app/versions", version);
  rmSync(app, { recursive: true, force: true });
  cpSync(out, app, { recursive: true });
  writeFileSync(join(home, "app/current.txt"), version);

  mkdirSync(join(home, "bin"), { recursive: true });
  for (const f of ["rawjobs", "rawjobs.cmd"]) copyFileSync(join(out, "bin", f), join(home, "bin", f));
  chmodSync(join(home, "bin/rawjobs"), 0o755);

  const launcher = join(home, "bin", process.platform === "win32" ? "rawjobs.cmd" : "rawjobs");
  console.log(`Installed as a trial in ${home}. Try:\n  "${launcher}" serve --open\n  "${launcher}" scan --plan`);
}

function run(cmd: string, args: string[]) {
  const r = spawnSync([cmd, ...args].join(" "), { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed.`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
