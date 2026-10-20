/** Node's side of zip.ts: inflate with a hard output cap, and read a ZIP from an open file. */
import type { FileHandle } from "node:fs/promises";
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import { type InflateRaw, ZipError, type ZipSource } from "./zip";

const inflate = promisify(inflateRaw);

/** zlib stops at `maxOutput` bytes (ERR_BUFFER_TOO_LARGE), so a ZIP bomb never fills memory. */
export const inflateRawNode: InflateRaw = async (data, maxOutput) => {
  try {
    const out = await inflate(data, { maxOutputLength: Math.max(1, maxOutput) });
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new ZipError("ZIP_TOO_BIG");
    throw e;
  }
};

/** A ZipSource over an open file; the caller closes the handle. */
export function fileZipSource(handle: FileHandle, size: number): ZipSource {
  return {
    size,
    read: async (offset, length) => {
      const buf = new Uint8Array(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await handle.read(buf, got, length - got, offset + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return buf.subarray(0, got);
    },
  };
}
