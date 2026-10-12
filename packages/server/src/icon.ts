import { deflateSync } from "node:zlib";

/**
 * The RawJobs mark (apps/web/src/design/logos/rawjobs-mark.svg: an orange bar on a dark square) as
 * icon files for the shortcuts, drawn here so the repo needs no image tools or binary files:
 * PNG (Linux), ICO (Windows) and ICNS (macOS). Edges are anti-aliased at every size.
 */

const BG = [0x15, 0x14, 0x12] as const;
const BAR = [0xff, 0x5a, 0x1f] as const;
/** The bar, in the SVG's 64-unit box. */
const BAR_BOX = { x0: 22, x1: 42, y0: 15, y1: 49 };

/** How much of pixel i (of `size`) the span [a, b] (in 64ths) covers, 0 to 1. */
function cover(i: number, size: number, a: number, b: number): number {
  const lo = Math.max(i, (a / 64) * size);
  const hi = Math.min(i + 1, (b / 64) * size);
  return Math.max(0, hi - lo);
}

/** RGBA pixels of the mark, `size` × `size`. */
export function markPixels(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const cy = cover(y, size, BAR_BOX.y0, BAR_BOX.y1);
    for (let x = 0; x < size; x++) {
      const t = cy * cover(x, size, BAR_BOX.x0, BAR_BOX.x1);
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c]! + (BAR[c]! - BG[c]!) * t);
      px[o + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** The mark as a PNG, `size` × `size`. */
export function iconPng(size: number): Buffer {
  const px = markPixels(size);
  // Each row starts with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A Windows .ico with PNG images (Windows Vista and newer read those). */
export function iconIco(sizes = [16, 24, 32, 48, 64, 128, 256]): Buffer {
  const images = sizes.map((s) => iconPng(s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; // 0 means 256
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(images[i]!.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i]!.length;
  });
  return Buffer.concat([head, ...images]);
}

/** A macOS .icns with PNG images (the types macOS 10.7 and newer read). */
export function iconIcns(): Buffer {
  const entries = (
    [
      ["icp4", 16],
      ["icp5", 32],
      ["icp6", 64],
      ["ic07", 128],
      ["ic08", 256],
      ["ic09", 512],
      ["ic10", 1024],
    ] as const
  ).map(([type, size]) => {
    const png = iconPng(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4);
  return Buffer.concat([head, ...entries]);
}
