import { describe, expect, it } from 'vitest';
import { crc32, zipStore, type ZipEntry } from './zip';

/** Minimal "store" ZIP reader to verify what is written. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const lho = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(lho, true)).toBe(0x04034b50);
    const lnl = v.getUint16(lho + 26, true);
    const lel = v.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    out.push({ name, data: zip.subarray(start, start + size), crc });
    p += 46 + nameLen;
  }
  return out;
}

describe('zipStore', () => {
  it('crc32 of a known string', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes and reads back several files with names, content and crc', () => {
    const entries: ZipEntry[] = [
      { name: 'a.stl', data: new TextEncoder().encode('ciao') },
      { name: 'cartella/b è.stl', data: Uint8Array.from({ length: 1000 }, (_, i) => i % 251) },
      { name: 'vuoto.txt', data: new Uint8Array() },
    ];
    const back = readZip(zipStore(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    back.forEach((e, i) => {
      expect([...e.data]).toEqual([...entries[i]!.data]);
      expect(e.crc).toBe(crc32(entries[i]!.data));
    });
  });

  it('the same content gives the same file', () => {
    const e = [{ name: 'x', data: new Uint8Array([1, 2, 3]) }];
    expect([...zipStore(e)]).toEqual([...zipStore(e)]);
  });
});
