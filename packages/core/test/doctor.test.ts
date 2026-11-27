import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runDoctor, writeDoctorZip } from "../src/doctor";
import { recordCrash } from "../src/log";
import { makeRedactor } from "../src/redact";
import { crc32, zipFiles } from "../src/zip";

// A made-up bot token, built at runtime so secret scanners do not flag the source as a leak.
const FAKE_BOT_TOKEN = ["123456789", "AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw2"].join(":");

/** The entries of a zip written by zipFiles, read back from its local headers. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const data = inflateRawSync(buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size));
    expect(crc32(data)).toBe(buf.readUInt32LE(at + 14));
    out.set(name, data.toString("utf8"));
    at += 30 + nameLen + size;
  }
  // Then the central directory and its end record, which say how many entries there are.
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(buf.readUInt16LE(end + 10)).toBe(out.size);
  return out;
}

describe("zip files", () => {
  it("round-trip, with the right checksums", () => {
    const files = unzip(
      zipFiles([
        { name: "a.txt", data: "hello ".repeat(100) },
        { name: "dir\\b.json", data: "{}" },
      ]),
    );
    expect(files.get("a.txt")).toBe("hello ".repeat(100));
    expect(files.get("dir/b.json")).toBe("{}");
  });

  it("checksums match the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("redaction", () => {
  it("takes out folders, names, tokens, chats, emails, profiles, queries, addresses and your companies", () => {
    const { redact, counts } = makeRedactor({
      home: "C:\\Users\\Ada\\AppData\\Local\\RawJobs",
      homedir: "C:\\Users\\Ada",
      user: "Ada",
      host: "ADA-LAPTOP",
      companies: ["Acme Labs", "Acme", "globex"],
    });
    const text = [
      "Saved to C:\\Users\\Ada\\AppData\\Local\\RawJobs\\data and C:/Users/Ada/Documents",
      `bot ${FAKE_BOT_TOKEN} chat_id=-100123 {"chatId":42}`,
      "Authorization: Bearer abcdefghijklmnop and token=supersecretvalue",
      "mail ada@example.com, see https://linkedin.com/in/ada-lovelace and https://x.example/jobs?q=product+manager&loc=uk",
      "from 192.168.1.20 on ADA-LAPTOP by ada; Acme Labs (acme) and Globex failed; 127.0.0.1 stays",
    ].join("\n");
    const out = redact(text);
    for (const gone of [
      "Ada",
      "ADA-LAPTOP",
      "AAHdq",
      "-100123",
      "42}",
      "abcdefghijklmnop",
      "supersecretvalue",
      "ada@example.com",
      "ada-lovelace",
      "product+manager",
      "192.168.1.20",
      "Acme",
      "acme",
      "Globex",
    ])
      expect(out, gone).not.toContain(gone);
    expect(out).toContain("<RAWJOBS_HOME>\\data");
    expect(out).toContain("<HOME>/Documents");
    expect(out).toContain("<company-1> (<company-3>) and <company-2> failed");
    expect(out).toContain("127.0.0.1 stays");
    expect(counts.token).toBe(1);
    expect(counts.email).toBe(1);
  });
});

describe("rawjobs doctor", () => {
  const copy = () => {
    const home = mkdtempSync(join(tmpdir(), "rj-doctor-"));
    const dataDir = join(home, "data");
    mkdirSync(join(home, "profile"), { recursive: true });
    mkdirSync(join(home, "logs"), { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(home, "rawjobs.config.local.yaml"),
      "profile:\n  titles: { include: [product manager] }\n  locations: { include: [london] }\ncompanies:\n  - { name: Initech, ats: greenhouse, slug: initech }\n",
    );
    writeFileSync(join(home, "profile/resume.md"), "secret resume");
    writeFileSync(join(home, "profile/secrets.json"), JSON.stringify({ telegram: { token: FAKE_BOT_TOKEN, chatId: "42" } }));
    writeFileSync(join(dataDir, "jobs.json"), '[{"title":"Head of Product at Initech"}]');
    writeFileSync(join(dataDir, "history.json"), "{}");
    writeFileSync(join(home, "logs/server.log"), `RawJobs 1.0.0 is starting.\nYour RawJobs folder: ${home}\nInitech failed: 500\n`);
    return { home, dataDir };
  };

  it("checks the copy and says what to fix", () => {
    const { home, dataDir } = copy();
    for (let i = 0; i < 3; i++) recordCrash(join(home, "logs"), new Error("boom"), { origin: "uncaughtException", where: "server", version: "1.0.0" });
    const report = runDoctor({ home, dataDir, exec: () => ({ status: 0, stdout: "" }) });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.crashes?.status).toBe("fail");
    expect(byId.config).toMatchObject({ status: "ok", title: "Your config reads fine (1 companies)" });
    expect(byId.telegram?.title).toBe("Telegram is set up");
  });

  it("saves a zip with the logs, redacted, and never the profile, config or jobs", () => {
    const { home, dataDir } = copy();
    const { path } = writeDoctorZip({ home, dataDir, exec: () => ({ status: 0, stdout: "" }), now: new Date("2026-11-27T10:00:00Z") });
    expect(path).toBe(join(home, "logs", "rawjobs-doctor-2026-11-27.zip"));
    const files = unzip(readFileSync(path));
    expect([...files.keys()].sort()).toEqual(["doctor.json", "files.txt", "logs/server.log"]);
    const all = [...files.values()].join("\n");
    for (const never of ["secret resume", "AAHdq", "Head of Product", home, "Initech", "initech"]) expect(all, never).not.toContain(never);
    expect(files.get("logs/server.log")).toContain("Your RawJobs folder: <RAWJOBS_HOME>");
    // Data files by name and size only.
    expect(files.get("files.txt")).toMatch(/data\/jobs\.json {2}\d+ {2}/);
    expect(JSON.parse(files.get("doctor.json")!).redacted.company).toBeGreaterThan(0);
  });
});
