import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReleaseManifest } from "../src/release";
import { migrateData, readDataFormat } from "../src/migrate";
import { parseReleaseNotes } from "../src/release";
import {
  backupData,
  downloadAhead,
  fetchManifest,
  finishUpdate,
  folderId,
  inTaskTree,
  installedVersions,
  judge,
  platformKey,
  prepareVersion,
  readLastUpdate,
  readUpdateFile,
  startServer,
  stopAllServers,
  switchTo,
  takeReady,
  TASK_REFUSED,
  TASK_RUNNING,
  type UpdateSystem,
  writeUpdateFile,
} from "../src/update";

const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((done) => s.listen(0, "127.0.0.1", () => done((s.address() as AddressInfo).port)));
}

const appendLog = (home: string, line: string) => {
  mkdirSync(join(home, "logs"), { recursive: true });
  appendFileSync(
    join(home, "logs/server.log"),
    `${new Date().toISOString()} ${line}
`,
  );
};

/** An installed copy on 0.1.0, with its Node already there (so no Node download). */
function installedCopy(nodeVersion = "v24.0.0") {
  const home = mkdtempSync(join(tmpdir(), "rj-upd-"));
  const node = `node-${nodeVersion}-${platformKey()}`;
  mkdirSync(join(home, "app/versions/0.1.0"), { recursive: true });
  mkdirSync(join(home, "runtime", node), { recursive: true });
  writeFileSync(join(home, "app/current.txt"), "0.1.0");
  writeFileSync(join(home, "runtime/current.txt"), node);
  mkdirSync(join(home, "profile"));
  writeFileSync(join(home, "profile/resume.md"), "v1 resume");
  return home;
}

/** A signed release of `version` served over http, with a bundle like pnpm bundle's. */
async function release(version: string, nodeVersion = "v24.0.0", tamper = false) {
  const dir = mkdtempSync(join(tmpdir(), "rj-rel-"));
  mkdirSync(join(dir, `rawjobs-${version}`));
  writeFileSync(join(dir, `rawjobs-${version}`, "cli.mjs"), "console.log('hi')\n");
  const file = `rawjobs-${version}.tar.gz`;
  expect(spawnSync(tar, ["-czf", join(dir, file), "-C", dir, `rawjobs-${version}`]).status).toBe(0);
  const m: ReleaseManifest = {
    app: "rawjobs",
    version,
    date: "2026-10-11",
    bundleFile: file,
    bundleSha256: createHash("sha256")
      .update(readFileSync(join(dir, file)))
      .digest("hex"),
    nodeVersion,
    nodeSha256: { [platformKey()]: "0".repeat(64) },
    minVersion: "0.0.0",
    critical: false,
    notes: "Faster scans.",
  };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const body = `${JSON.stringify(m, null, 2)}\n`;
  writeFileSync(join(dir, "latest.json"), tamper ? body.replace("Faster", "Slower") : body);
  writeFileSync(join(dir, "latest.json.sig"), sign(null, Buffer.from(body), privateKey).toString("base64"));
  const port = await serve((req, res) => {
    const f = join(dir, (req.url ?? "/").slice(1));
    if (!existsSync(f)) {
      res.statusCode = 404;
      return res.end();
    }
    res.end(readFileSync(f));
  });
  return { base: `http://127.0.0.1:${port}`, publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"), manifest: m };
}

describe("judge", () => {
  const m = (version: string, minVersion = "0.0.0") => ({ version, minVersion }) as ReleaseManifest;
  it("offers newer versions, not ones that failed here, and says when this one is too old", () => {
    expect(judge("0.2.0", m("0.3.0")).available).toBe(true);
    expect(judge("0.3.0", m("0.3.0")).available).toBe(false);
    expect(judge("0.2.0", m("0.3.0"), ["0.3.0"]).available).toBe(false);
    expect(judge("0.2.0", m("0.3.0", "0.2.5")).tooOld).toBe(true);
    expect(judge("0.9.0", m("1.0.0")).major).toBe(true);
    expect(judge("0.2.0", m("0.3.0")).major).toBe(false);
  });
});

describe("updating an installed copy", () => {
  it("accepts only a release signed by the key", async () => {
    const r = await release("0.2.0");
    await expect(fetchManifest(r.base, { publicKey: r.publicKey })).resolves.toMatchObject({ version: "0.2.0" });
    await expect(fetchManifest(r.base)).rejects.toThrow(/signature/);
    const bad = await release("0.2.0", "v24.0.0", true);
    await expect(fetchManifest(bad.base, { publicKey: bad.publicKey })).rejects.toThrow(/signature/);
  });

  it("puts the new version next to the old one, then switches and remembers the old one", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    expect(readFileSync(join(home, "app/versions/0.2.0/cli.mjs"), "utf8")).toContain("hi");
    expect(installedVersions(home)?.current).toBe("0.1.0");
    switchTo(home, v.version, v.node);
    expect(installedVersions(home)).toMatchObject({ current: "0.2.0", previous: "0.1.0" });
  });

  it("refuses a bundle that doesn't match the checksum", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    await expect(prepareVersion(home, r.base, { ...r.manifest, bundleSha256: "f".repeat(64) })).rejects.toThrow(/checksum/);
    expect(existsSync(join(home, "app/versions/0.2.0"))).toBe(false);
  });

  it("keeps the new version when it answers, and cleans up older ones", async () => {
    const home = installedCopy();
    mkdirSync(join(home, "app/versions/0.0.9"));
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    switchTo(home, v.version, v.node);
    const record = await finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      notes: "Faster scans.",
      timeoutMs: 5000,
      pollMs: 50,
      ports: [],
      // "Starting the server": one that answers as the new version.
      start: () => void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.2.0" }))).then((port) => writeFileSync(join(home, "state.json"), JSON.stringify({ port }))),
    });
    expect(record).toMatchObject({ ok: true, from: "0.1.0", to: "0.2.0", notes: "Faster scans." });
    expect(readLastUpdate(home)?.ok).toBe(true);
    expect(existsSync(join(home, "app/versions/0.0.9"))).toBe(false);
    expect(existsSync(join(home, "app/versions/0.1.0"))).toBe(true);
  });

  it("also stops a second server of this folder, so the new version can start", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    switchTo(home, v.version, v.node);
    // A second 0.1.0 server, started on the next port when the first was slow to answer: state.json names it.
    const other = spawn(
      process.execPath,
      ["-e", `require("http").createServer((q,s)=>s.end(JSON.stringify({ok:true,version:"0.1.0"}))).listen(0,"127.0.0.1",function(){console.log(this.address().port)})`],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const port = await new Promise<number>((done) => other.stdout!.once("data", (d) => done(Number(String(d).trim()))));
    writeFileSync(join(home, "state.json"), JSON.stringify({ port, pid: other.pid, version: "0.1.0" }));
    const gone = new Promise<void>((done) => other.once("exit", () => done()));
    let startedWhileOtherRan = false;
    const record = await finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      timeoutMs: 5000,
      pollMs: 50,
      ports: [],
      // The computer's scheduler starts nothing while it still runs the other server.
      start: () => {
        startedWhileOtherRan = other.exitCode === null && other.signalCode === null;
        if (startedWhileOtherRan) return;
        void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.2.0" }))).then((p) => writeFileSync(join(home, "state.json"), JSON.stringify({ port: p })));
      },
    });
    await gone;
    expect(startedWhileOtherRan).toBe(false);
    expect(record.ok).toBe(true);
  }, 15_000);

  /** Finish an update to 0.2.0 that never answers; 0.1.0 answers once it's started again. */
  async function failedUpdate(home: string, backup: string, starts: string[] = [], ran = true) {
    return finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      backup,
      timeoutMs: 800,
      pollMs: 50,
      ports: [],
      start: () => {
        const v = installedVersions(home)!.current;
        starts.push(v);
        // The new version starts (its first line is in the log), then never answers.
        if (v === "0.2.0" && ran) appendLog(home, "RawJobs 0.2.0 is starting.");
        if (v === "0.1.0") void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.1.0" }))).then((port) => writeFileSync(join(home, "state.json"), JSON.stringify({ port })));
      },
    });
  }

  it("goes back, keeps the data saved meanwhile, and won't offer it again when the new version doesn't answer", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    const backup = backupData(home, "before-0.2.0");
    switchTo(home, v.version, v.node);
    // A scheduled scan saved its jobs while the update ran.
    mkdirSync(join(home, "data"), { recursive: true });
    writeFileSync(join(home, "data/jobs.json"), "found during the update");
    const starts: string[] = [];
    const record = await failedUpdate(home, backup, starts);
    expect(record.ok).toBe(false);
    expect(record.error).toMatch(/0\.1\.0 is back/);
    expect(installedVersions(home)?.current).toBe("0.1.0");
    expect(readFileSync(join(home, "data/jobs.json"), "utf8")).toBe("found during the update");
    expect(readFileSync(join(home, "profile/resume.md"), "utf8")).toBe("v1 resume");
    expect(readUpdateFile(home).skip).toEqual(["0.2.0"]);
    // Started the new version, then the old one again.
    expect(starts).toEqual(["0.2.0", "0.1.0"]);
    // The failed version is gone; nothing is left to go back to from 0.1.0.
    expect(existsSync(join(home, "app/versions/0.2.0"))).toBe(false);
    expect(installedVersions(home)?.previous).toBeNull();
  });

  it("puts the backup back when the new version had converted the data", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    const backup = backupData(home, "before-0.2.0");
    switchTo(home, v.version, v.node);
    mkdirSync(join(home, "data"), { recursive: true });
    writeFileSync(join(home, "data/format.json"), JSON.stringify({ format: 2 }));
    writeFileSync(join(home, "profile/resume.md"), "converted by the new version");
    await failedUpdate(home, backup);
    expect(readFileSync(join(home, "profile/resume.md"), "utf8")).toBe("v1 resume");
    expect(readDataFormat(join(home, "data"))).toBe(1);
  });

  it("downloads a new version ahead of time and installs it from there", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    await downloadAhead(home, r.base, r.manifest);
    expect(readUpdateFile(home).ready?.version).toBe("0.2.0");
    // Nothing installed: the running version is untouched.
    expect(installedVersions(home)?.current).toBe("0.1.0");
    expect(existsSync(join(home, "app/versions/0.2.0"))).toBe(false);
    expect(takeReady(home, { ...r.manifest, version: "0.3.0" })).toBeNull();
    expect(takeReady(home, r.manifest)).toMatchObject({ version: "0.2.0" });
    expect(existsSync(join(home, "app/versions/0.2.0/cli.mjs"))).toBe(true);
    expect(readUpdateFile(home).ready).toBeUndefined();
  });

  it("keeps offering a new version the computer never started, and says so", async () => {
    const home = installedCopy();
    const r = await release("0.2.0");
    const v = await prepareVersion(home, r.base, r.manifest);
    const backup = backupData(home, "before-0.2.0");
    switchTo(home, v.version, v.node);
    // An old line from 0.2.0 (an earlier try) doesn't count: only what's written after the start.
    appendLog(home, "RawJobs 0.2.0 is starting.");
    const record = await failedUpdate(home, backup, [], false);
    expect(record.ok).toBe(false);
    expect(record.error).toMatch(/didn't start RawJobs 0\.2\.0, so 0\.1\.0 is back\. Update tries it again/);
    expect(installedVersions(home)?.current).toBe("0.1.0");
    expect(readUpdateFile(home).skip ?? []).toEqual([]);
  });
});

/** A computer for the update helper: servers by port and process, programs it runs, what it starts. */
function fakeComputer(o: { servers?: Record<number, { pid: number; home?: string }>; listeners?: string; task?: { state: string; result: number } }) {
  const running = new Set(Object.values(o.servers ?? {}).map((s) => s.pid));
  const scripts: string[] = [];
  const launched: string[][] = [];
  const sys: UpdateSystem = {
    platform: "win32",
    fetch: (async (url: string) => {
      const s = o.servers?.[Number(new URL(url).port)];
      if (!s || !running.has(s.pid)) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify({ ok: true, version: "0.1.0", home: s.home, pid: s.pid }));
    }) as typeof fetch,
    run: (_cmd, args) => {
      const script = args.at(-1)!;
      scripts.push(script);
      const out = (stdout: string, status = 0) => ({ status, stdout, stderr: "" });
      if (script.includes("Get-NetTCPConnection")) return out(o.listeners ?? "");
      if (script.includes("Get-ScheduledTaskInfo")) return out(String(o.task?.result ?? 0));
      if (script.includes("Get-ScheduledTask ")) return o.task ? out(o.task.state) : out("", 1);
      if (script.includes("Win32_Process")) return out("");
      return out("");
    },
    launch: (cmd, args) => void launched.push([cmd, ...args]),
    alive: (pid) => running.has(pid),
    kill: (pid) => void running.delete(pid),
    sleep: async () => {},
  };
  return { sys, running, scripts, launched };
}

describe("restarting the server for an update", () => {
  it("stops every server of this folder (4317 and 4318, and a hung one), and nothing else", async () => {
    const home = installedCopy();
    const id = folderId(home);
    // 4317: the task's server; 4318: one started next to it (state.json's); 4319: another folder's.
    // 4320 doesn't answer, but its process runs from this folder; 4321 is another program.
    const pc = fakeComputer({
      servers: { 4317: { pid: 101, home: id }, 4318: { pid: 102, home: id }, 4319: { pid: 103, home: "someone-else" } },
      listeners: `4319\t103\tnode other\\cli.mjs serve\r\n4320\t104\t"${join(home, "runtime\\node.exe")}" "${join(home, "app\\versions\\0.1.0\\cli.mjs")}" serve\r\n4321\t105\tC:\\Program Files\\Other\\other.exe\r\n`,
    });
    pc.running.add(104).add(105);
    writeFileSync(join(home, "state.json"), JSON.stringify({ port: 4318, pid: 102, version: "0.1.0" }));
    expect(await stopAllServers(home, { sys: pc.sys, ports: [4317, 4318, 4319, 4320, 4321] })).toBe(3);
    expect([...pc.running].sort()).toEqual([103, 105]);
  });

  it("finishes an update with both servers stopped before the new version starts", async () => {
    const home = installedCopy();
    const id = folderId(home);
    const pc = fakeComputer({ servers: { 4317: { pid: 201, home: id }, 4318: { pid: 202, home: id } } });
    writeFileSync(join(home, "state.json"), JSON.stringify({ port: 4318, pid: 202, version: "0.1.0" }));
    let stillRunning: number[] | null = null;
    const record = await finishUpdate({
      home,
      from: "0.1.0",
      to: "0.2.0",
      pid: 202,
      timeoutMs: 5000,
      pollMs: 50,
      ports: [4317, 4318],
      sys: pc.sys,
      start: () => {
        stillRunning = [...pc.running];
        void serve((_q, res) => res.end(JSON.stringify({ ok: true, version: "0.2.0" }))).then((port) => writeFileSync(join(home, "state.json"), JSON.stringify({ port })));
      },
    });
    expect(stillRunning).toEqual([]);
    expect(record.ok).toBe(true);
  });

  it("ends the task's old run, then starts the task (Windows)", async () => {
    const pc = fakeComputer({ task: { state: "Running", result: TASK_RUNNING } });
    await startServer(installedCopy(), { sys: pc.sys });
    const stop = pc.scripts.findIndex((s) => s.startsWith("Stop-ScheduledTask"));
    const start = pc.scripts.findIndex((s) => s.startsWith("Start-ScheduledTask"));
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(stop);
    expect(pc.launched).toEqual([]);
  });

  it("doesn't end the task it runs in, and starts the server directly when Windows refuses the task", async () => {
    const home = installedCopy();
    const pc = fakeComputer({ task: { state: "Running", result: TASK_REFUSED } });
    await startServer(home, { sys: pc.sys, insideTask: true });
    expect(pc.scripts.some((s) => s.startsWith("Stop-ScheduledTask"))).toBe(false);
    expect(pc.scripts.some((s) => s.startsWith("Start-ScheduledTask"))).toBe(true);
    expect(pc.launched).toEqual([["conhost.exe", "--headless", join(home, "bin/rawjobs.cmd"), "serve", "--log", join(home, "logs/server.log")]]);
  });

  it("starts the server directly when the task starts nothing", async () => {
    const pc = fakeComputer({ task: { state: "Ready", result: 0 } });
    await startServer(installedCopy(), { sys: pc.sys });
    expect(pc.scripts.some((s) => s.startsWith("Stop-ScheduledTask"))).toBe(false);
    expect(pc.launched).toHaveLength(1);
  });

  it("knows when it runs inside the RawJobs Server task", () => {
    const task = ["cmd.exe\tC:\\WINDOWS\\system32\\cmd.exe /c rawjobs.cmd serve --log x", 'conhost.exe\t"conhost.exe" --headless "rawjobs.cmd" serve --log x', "svchost.exe\t"];
    expect(inTaskTree(["node.exe\tnode cli.mjs serve", ...task])).toBe(true);
    // Started from the shortcut, or from a terminal.
    expect(inTaskTree(["cmd.exe\tcmd /c rawjobs.cmd serve", 'conhost.exe\t"conhost.exe" --headless "rawjobs.cmd" open', "explorer.exe\t"])).toBe(false);
    expect(inTaskTree(["powershell.exe\tpowershell", "WindowsTerminal.exe\t"])).toBe(false);
  });
});

describe("what an update keeps", () => {
  it("never installs by itself: Automatic from before is Ask me now", () => {
    const home = installedCopy();
    expect(readUpdateFile(home).mode).toBe("ask");
    writeFileSync(join(home, "updates.json"), JSON.stringify({ mode: "auto" }));
    expect(readUpdateFile(home).mode).toBe("ask");
    writeUpdateFile(home, { mode: "off" });
    expect(readUpdateFile(home).mode).toBe("off");
  });

  it("backs up all your data, but not what downloads again or a scan's flags", () => {
    const home = installedCopy();
    for (const d of ["data/runs", "data/cache", "data/catalog"]) mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, "data/jobs.json"), "jobs");
    writeFileSync(join(home, "data/runs/2026-10-12.json"), "a run");
    writeFileSync(join(home, "data/cache/x.json"), "cache");
    writeFileSync(join(home, "data/catalog/index.json"), "directory");
    writeFileSync(join(home, "data/catalog/additions.json"), "my additions");
    writeFileSync(join(home, "data/scan.lock"), "123");
    writeFileSync(join(home, "rawjobs.config.local.yaml"), "profile: {}");
    const b = backupData(home, "before-0.2.0");
    expect(readFileSync(join(b, "data/jobs.json"), "utf8")).toBe("jobs");
    expect(readFileSync(join(b, "data/runs/2026-10-12.json"), "utf8")).toBe("a run");
    expect(readFileSync(join(b, "data/catalog/additions.json"), "utf8")).toBe("my additions");
    expect(readFileSync(join(b, "profile/resume.md"), "utf8")).toBe("v1 resume");
    expect(existsSync(join(b, "rawjobs.config.local.yaml"))).toBe(true);
    expect(existsSync(join(b, "data/cache"))).toBe(false);
    expect(existsSync(join(b, "data/catalog/index.json"))).toBe(false);
    expect(existsSync(join(b, "data/scan.lock"))).toBe(false);
  });

  it("reads the data format, the first one when none is recorded", () => {
    const home = installedCopy();
    expect(readDataFormat(join(home, "data"))).toBe(1);
    expect(migrateData(home, join(home, "data"))).toBe(1);
  });
});

describe("release notes", () => {
  it("take the mandatory and minimum-version lines out of the notes", () => {
    expect(parseReleaseNotes("RawJobs 0.5.1\n\n- Faster scans")).toEqual({ notes: "RawJobs 0.5.1\n\n- Faster scans", critical: false, minVersion: null, changes: [] });
    expect(parseReleaseNotes("Fixes alerts.\r\nUpdate: mandatory\r\nMin-version: v0.4.0\r\n")).toEqual({ notes: "Fixes alerts.", critical: true, minVersion: "0.4.0", changes: [] });
    expect(parseReleaseNotes("Update: optional").critical).toBe(false);
  });
});
