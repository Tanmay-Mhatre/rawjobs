/** Builds ZIPs in tests, so no binary is committed. Knobs for each way a ZIP can lie. */
import { crc32, deflateRawSync } from "node:zlib";

export type TestEntry = {
  name: string;
  data: string | Uint8Array;
  /** 0 stored, 8 deflate (default). */
  method?: number;
  /** Extra general-purpose flags (bit 0 = encrypted). Bit 3 is always set, like LinkedIn's exports. */
  flags?: number;
  /** Lie about the inflated size in the central directory. */
  declaredSize?: number;
  /** Lie about where the local header is. */
  localOffset?: number;
};

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

export function makeZip(entries: TestEntry[], { count, comment = "" }: { count?: number; comment?: string } = {}): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const packed = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(e.name);
    const crc = crc32(raw);
    const flags = 0x0008 | 0x0800 | (e.flags ?? 0);
    const at = local.length;
    // Local header with zero sizes and CRC (flag bit 3), the data, then a data descriptor.
    local.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0));
    local.push(...u16(name.length), ...u16(0), ...name, ...packed);
    local.push(...u32(0x08074b50), ...u32(crc), ...u32(packed.length), ...u32(raw.length));
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...u32(crc));
    central.push(...u32(packed.length), ...u32(e.declaredSize ?? raw.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    central.push(...u32(0), ...u32(e.localOffset ?? at), ...name);
  }
  const n = count ?? entries.length;
  const c = enc.encode(comment);
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(central.length), ...u32(local.length), ...u16(c.length), ...c];
  return new Uint8Array([...local, ...central, ...end]);
}
