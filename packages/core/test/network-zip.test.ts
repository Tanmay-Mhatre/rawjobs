import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { exportFilesFromEntries, isAllowedEntry } from "../src/network/linkedin-export";
import { blobZipSource, canInflateRaw, inflateRawStream } from "../src/network/zip-browser";
import { inflateRawNode } from "../src/network/zip-node";
import { bytesSource, type InflateRaw, readZipEntries, ZipError } from "../src/network/zip";
import { makeZip } from "./fixtures/linkedin/make-zip";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/linkedin/${name}`, import.meta.url), "utf8");
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ZipError ? e.code : `other: ${String(e)}`;
  }
}

const read = (zip: Uint8Array, inflate: InflateRaw = inflateRawNode, limits = {}) => readZipEntries(bytesSource(zip), inflate, isAllowedEntry, limits);

describe("readZipEntries", () => {
  const exportZip = makeZip([
    { name: "messages.csv", data: "FROM,TO,CONTENT\nsecret,secret,secret message\n" },
    { name: "Invitations.csv", data: "From,To\nx,y\n" },
    { name: "Connections.csv", data: fixture("Connections.csv") },
    { name: "Connections/Connections.csv", data: "First Name,URL\nNested,\n" },
    { name: "Positions.csv", data: fixture("Positions.csv"), method: 0 },
    { name: "Education.csv", data: fixture("Education.csv") },
  ]);

  it("reads only allowlisted entries and never inflates the others", async () => {
    const spy = vi.fn(inflateRawNode);
    const entries = await read(exportZip, spy);
    expect(entries.map((e) => e.name)).toEqual(["Connections.csv", "Connections/Connections.csv", "Positions.csv", "Education.csv"]);
    // Positions is stored, so three inflations: both Connections and Education.
    expect(spy).toHaveBeenCalledTimes(3);
    const inflated = spy.mock.results.map((r) => r.value);
    const outs = (await Promise.all(inflated)).map(text);
    expect(outs.some((o) => o.includes("secret message"))).toBe(false);
    expect(text(entries[0]!.data)).toBe(fixture("Connections.csv"));
  });

  it("picks the shallowest copy of each file", async () => {
    const files = exportFilesFromEntries(await read(exportZip));
    expect(files.connections).toBe(fixture("Connections.csv"));
    expect(files.positions).toBe(fixture("Positions.csv"));
    expect(files.education).toBe(fixture("Education.csv"));
  });

  it("matches allowlisted names on the basename, in any case", () => {
    expect(isAllowedEntry("Basic_LinkedInDataExport/CONNECTIONS.CSV")).toBe(true);
    expect(isAllowedEntry("x\\Positions.csv")).toBe(true);
    expect(isAllowedEntry("messages.csv")).toBe(false);
    expect(isAllowedEntry("Connections.csv.exe")).toBe(false);
  });

  it("takes sizes from the central directory when flag bit 3 zeroes the local header", async () => {
    const entries = await read(makeZip([{ name: "Connections.csv", data: "a".repeat(5000) }]));
    expect(entries[0]!.data.length).toBe(5000);
  });

  it("skips a ZIP comment", async () => {
    const entries = await read(makeZip([{ name: "Connections.csv", data: "hi" }], { comment: "PK\u0005\u0006 not the end" }));
    expect(text(entries[0]!.data)).toBe("hi");
  });

  it("rejects an understated declared size", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x".repeat(1000), declaredSize: 10 }])))).toBe("ZIP_MALFORMED");
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x".repeat(1000), declaredSize: 10, method: 0 }])))).toBe("ZIP_MALFORMED");
  });

  it("rejects an overstated declared size", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x".repeat(100), declaredSize: 5000 }])))).toBe("ZIP_MALFORMED");
  });

  it("stops inflating at the declared size (a ZIP bomb never fills memory)", async () => {
    const spy = vi.fn(inflateRawNode);
    await codeOf(read(makeZip([{ name: "Connections.csv", data: "0".repeat(2_000_000), declaredSize: 100 }]), spy));
    expect(spy.mock.calls[0]![1]).toBe(101);
    expect(await codeOf(inflateRawNode(new Uint8Array(await deflate("0".repeat(2_000_000))), 1000))).toBe("ZIP_TOO_BIG");
  });

  it("rejects an entry over the cap", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x".repeat(2000) }]), inflateRawNode, { maxEntryBytes: 1000 }))).toBe("ZIP_TOO_BIG");
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x", declaredSize: 50_000_000 }])))).toBe("ZIP_TOO_BIG");
  });

  it("rejects a total over the cap", async () => {
    const zip = makeZip([
      { name: "Connections.csv", data: "x".repeat(800) },
      { name: "Positions.csv", data: "x".repeat(800) },
    ]);
    expect(await codeOf(read(zip, inflateRawNode, { maxTotalBytes: 1000 }))).toBe("ZIP_TOO_BIG");
  });

  it("rejects encrypted entries", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x", flags: 1 }])))).toBe("ZIP_ENCRYPTED");
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x", method: 99 }])))).toBe("ZIP_ENCRYPTED");
  });

  it("doesn't care about an encrypted entry it doesn't read", async () => {
    const entries = await read(
      makeZip([
        { name: "messages.csv", data: "x", flags: 1 },
        { name: "Connections.csv", data: "ok" },
      ]),
    );
    expect(entries.map((e) => e.name)).toEqual(["Connections.csv"]);
  });

  it("rejects ZIP64", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x" }], { count: 0xffff })))).toBe("ZIP_TOO_BIG");
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x", declaredSize: 0xffffffff }])))).toBe("ZIP_TOO_BIG");
  });

  it("rejects more than 10,000 entries", async () => {
    const zip = makeZip([{ name: "Connections.csv", data: "x" }], { count: 10_001 });
    expect(await codeOf(read(zip))).toBe("ZIP_TOO_BIG");
  });

  it("rejects something that isn't a ZIP", async () => {
    expect(await codeOf(read(new TextEncoder().encode("First Name,Last Name\nA,B\n")))).toBe("NOT_ZIP");
    expect(await codeOf(read(new Uint8Array(0)))).toBe("NOT_ZIP");
  });

  it("rejects a truncated end of central directory", async () => {
    const zip = makeZip([{ name: "Connections.csv", data: "x" }]);
    expect(await codeOf(read(zip.subarray(0, zip.length - 5)))).toBe("ZIP_MALFORMED");
    expect(await codeOf(read(zip.subarray(0, zip.length - 30)))).toBe("ZIP_MALFORMED");
  });

  it("rejects an offset past the end of the file", async () => {
    expect(await codeOf(read(makeZip([{ name: "Connections.csv", data: "x", localOffset: 1_000_000 }])))).toBe("ZIP_MALFORMED");
    const zip = makeZip([{ name: "Connections.csv", data: "x" }]);
    // Point the directory offset (EOCD bytes 16-19) past the file.
    const bad = zip.slice();
    new DataView(bad.buffer).setUint32(bad.length - 22 + 16, 0x7fffffff, true);
    expect(await codeOf(read(bad))).toBe("ZIP_MALFORMED");
  });

  it("rejects corrupt deflate data", async () => {
    const zip = makeZip([{ name: "Connections.csv", data: "hello hello hello" }]);
    const bad = zip.slice();
    bad.fill(0xff, 30 + "Connections.csv".length, 30 + "Connections.csv".length + 4);
    expect(await codeOf(read(bad))).toBe("ZIP_MALFORMED");
  });
});

describe("browser inflate", () => {
  it("has deflate-raw here", () => {
    expect(canInflateRaw()).toBe(true);
  });

  it("reads the same entries through a Blob and DecompressionStream", async () => {
    const zip = makeZip([
      { name: "Connections.csv", data: fixture("Connections.csv") },
      { name: "messages.csv", data: "secret" },
    ]);
    const entries = await readZipEntries(blobZipSource(new Blob([zip])), inflateRawStream, isAllowedEntry);
    expect(entries.map((e) => [e.name, text(e.data)])).toEqual([["Connections.csv", fixture("Connections.csv")]]);
  });

  it("aborts once the output passes the cap", async () => {
    expect(await codeOf(inflateRawStream(new Uint8Array(await deflate("0".repeat(2_000_000))), 1000))).toBe("ZIP_TOO_BIG");
    const zip = makeZip([{ name: "Connections.csv", data: "0".repeat(500_000), declaredSize: 100 }]);
    expect(await codeOf(readZipEntries(blobZipSource(new Blob([zip])), inflateRawStream, isAllowedEntry))).toBe("ZIP_MALFORMED");
  });
});

async function deflate(s: string): Promise<Uint8Array> {
  const { deflateRawSync } = await import("node:zlib");
  return new Uint8Array(deflateRawSync(new TextEncoder().encode(s)));
}
