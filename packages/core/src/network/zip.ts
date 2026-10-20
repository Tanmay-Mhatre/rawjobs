/**
 * A small, careful ZIP reader for LinkedIn's data export. Pure: it reads through `source` and
 * inflates through an injected function (zip-node.ts for Node, zip-browser.ts for the browser).
 *
 * - The central directory is the only source of sizes, method and flags. LinkedIn's exports set
 *   flag bit 3, so local headers carry zeros; a local header is only skipped over.
 * - Every offset is checked against the file size. At most 10,000 entries.
 * - Only entries `want()` accepts are ever read or inflated.
 * - Declared sizes aren't trusted: inflating stops at the declared size (and the cap), and an entry
 *   whose real size differs from the declared one is rejected.
 */

export type ZipErrorCode = "NOT_ZIP" | "ZIP_MALFORMED" | "ZIP_TOO_BIG" | "ZIP_ENCRYPTED";

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

/** Random access to the ZIP's bytes: a file handle in Node, a Blob in the browser. */
export type ZipSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

/**
 * Inflates raw deflate data. Must reject with `ZipError("ZIP_TOO_BIG")` (or any error) once the
 * output would pass `maxOutput` bytes, without producing more than that.
 */
export type InflateRaw = (data: Uint8Array, maxOutput: number) => Promise<Uint8Array>;

export type ZipEntry = { name: string; data: Uint8Array };

export type ZipLimits = {
  /** Largest inflated entry (default 10 MB, the CSV cap). */
  maxEntryBytes?: number;
  /** Largest total of the entries read (default 30 MB). */
  maxTotalBytes?: number;
};

export const MAX_ZIP_ENTRIES = 10_000;
const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
/** 10,000 entries with long names fit well inside this. */
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;

/** A ZipSource over bytes already in memory. */
export function bytesSource(bytes: Uint8Array): ZipSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

/** The part of a path after the last / or \. */
export function zipBasename(name: string): string {
  return name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
}

async function readExact(src: ZipSource, offset: number, length: number): Promise<DataView> {
  if (offset < 0 || length < 0 || offset + length > src.size) throw new ZipError("ZIP_MALFORMED", "Offset past the end of the file");
  const bytes = await src.read(offset, length);
  if (bytes.length !== length) throw new ZipError("ZIP_MALFORMED", "Short read");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function bytesOf(view: DataView, offset: number, length: number): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset + offset, length);
}

/** Finds the end-of-central-directory record, scanning back over a comment of up to 64 KB. */
async function findEnd(src: ZipSource): Promise<{ view: DataView; at: number }> {
  const tailLength = Math.min(src.size, EOCD_SIZE + MAX_COMMENT);
  const tail = await readExact(src, src.size - tailLength, tailLength);
  for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.getUint32(i, true) !== EOCD_SIG) continue;
    // The comment has to run exactly to the end of the file, so a signature inside data isn't taken.
    if (i + EOCD_SIZE + tail.getUint16(i + 20, true) !== tailLength) continue;
    return { view: new DataView(tail.buffer, tail.byteOffset + i, EOCD_SIZE), at: src.size - tailLength + i };
  }
  throw new ZipError("ZIP_MALFORMED", "No end of central directory");
}

const utf8 = new TextDecoder("utf-8");

/** Reads the entries whose names `want()` accepts. Nothing else is read past its directory record. */
export async function readZipEntries(src: ZipSource, inflateRaw: InflateRaw, want: (name: string) => boolean, limits: ZipLimits = {}): Promise<ZipEntry[]> {
  const maxEntry = limits.maxEntryBytes ?? 10_000_000;
  const maxTotal = limits.maxTotalBytes ?? 30_000_000;
  if (src.size < 4) throw new ZipError("NOT_ZIP");
  const magic = (await readExact(src, 0, 4)).getUint32(0, true);
  if (magic !== LOCAL_SIG && magic !== EOCD_SIG) throw new ZipError("NOT_ZIP");
  if (src.size < EOCD_SIZE) throw new ZipError("ZIP_MALFORMED", "Too short");

  const { view: end, at: endAt } = await findEnd(src);
  const disk = end.getUint16(4, true);
  const dirDisk = end.getUint16(6, true);
  const onDisk = end.getUint16(8, true);
  const count = end.getUint16(10, true);
  const dirSize = end.getUint32(12, true);
  const dirOffset = end.getUint32(16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new ZipError("ZIP_TOO_BIG", "ZIP64");
  if (endAt >= 20 && (await readExact(src, endAt - 20, 4)).getUint32(0, true) === EOCD64_LOCATOR_SIG) throw new ZipError("ZIP_TOO_BIG", "ZIP64");
  if (disk !== 0 || dirDisk !== 0 || onDisk !== count) throw new ZipError("ZIP_MALFORMED", "Split archive");
  if (count > MAX_ZIP_ENTRIES) throw new ZipError("ZIP_TOO_BIG", "Too many entries");
  if (dirSize > MAX_DIRECTORY_BYTES) throw new ZipError("ZIP_TOO_BIG", "Directory too big");
  if (dirOffset + dirSize > endAt) throw new ZipError("ZIP_MALFORMED", "Directory past its end record");

  const dir = await readExact(src, dirOffset, dirSize);
  const out: ZipEntry[] = [];
  let total = 0;
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dirSize || dir.getUint32(p, true) !== CENTRAL_SIG) throw new ZipError("ZIP_MALFORMED", "Bad directory record");
    const flags = dir.getUint16(p + 8, true);
    const method = dir.getUint16(p + 10, true);
    const packed = dir.getUint32(p + 20, true);
    const size = dir.getUint32(p + 24, true);
    const nameLength = dir.getUint16(p + 28, true);
    const extraLength = dir.getUint16(p + 30, true);
    const commentLength = dir.getUint16(p + 32, true);
    const localAt = dir.getUint32(p + 42, true);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > dirSize) throw new ZipError("ZIP_MALFORMED", "Directory record past its end");
    const name = utf8.decode(bytesOf(dir, p + 46, nameLength));
    p = next;
    if (name.endsWith("/") || !want(name)) continue;

    if (flags & 1 || method === 99) throw new ZipError("ZIP_ENCRYPTED");
    if (packed === 0xffffffff || size === 0xffffffff) throw new ZipError("ZIP_TOO_BIG", "ZIP64");
    if (method !== 0 && method !== 8) throw new ZipError("ZIP_MALFORMED", "Unsupported method");
    if (size > maxEntry || total + size > maxTotal) throw new ZipError("ZIP_TOO_BIG");

    const local = await readExact(src, localAt, 30);
    if (local.getUint32(0, true) !== LOCAL_SIG) throw new ZipError("ZIP_MALFORMED", "Bad local header");
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    if (dataAt + packed > dirOffset) throw new ZipError("ZIP_MALFORMED", "Entry data past its end");
    const raw = bytesOf(await readExact(src, dataAt, packed), 0, packed);

    let data: Uint8Array;
    if (method === 0) {
      data = raw;
    } else {
      try {
        // Stop at the declared size: anything longer is a lie, rejected below either way.
        data = await inflateRaw(raw, size + 1);
      } catch {
        throw new ZipError("ZIP_MALFORMED", "Entry doesn't inflate to its declared size");
      }
    }
    if (data.length !== size) throw new ZipError("ZIP_MALFORMED", "Entry doesn't match its declared size");
    total += size;
    out.push({ name, data });
  }
  return out;
}
