/** The browser's side of zip.ts: inflate through DecompressionStream, counting bytes, and read a ZIP from a Blob. */
import { type InflateRaw, ZipError, type ZipSource } from "./zip";

/** False on browsers without "deflate-raw"; the dialog then asks for Connections.csv instead. */
export function canInflateRaw(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** Streams the data through the browser's inflater and aborts as soon as the output passes `maxOutput`. */
export const inflateRawStream: InflateRaw = async (data, maxOutput) => {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOutput) {
      await reader.cancel().catch(() => {});
      throw new ZipError("ZIP_TOO_BIG");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** A ZipSource over a picked or dropped file: only the parts asked for are read. */
export function blobZipSource(blob: Blob): ZipSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}
