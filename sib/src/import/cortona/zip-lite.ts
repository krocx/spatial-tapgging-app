// zip-lite.ts — minimal ZIP reader (stored + deflate), dependency-free.
//
// Cortona3D's published bundle is a small ZIP carried as base64 inside the
// .htm; its entries are ZIP-stored (method 0) with gzip payloads inside, or
// ZIP-deflated (method 8). We only need the central directory + local headers.
// No encryption, no ZIP64, no multi-disk — the findings reports confirm none
// of those appear; we fail loudly if they do.

import zlib from 'zlib';

export interface ZipEntry {
  name:   string;
  data:   Buffer;
  method: number;
}

const SIG_LOCAL   = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD    = 0x06054b50;

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === SIG_LOCAL;
}

export function readZip(buf: Buffer): ZipEntry[] {
  // Locate EOCD (search backwards; comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found');
  const count   = buf.readUInt16LE(eocd + 10);
  const cdSize  = buf.readUInt32LE(eocd + 12);
  const cdStart = buf.readUInt32LE(eocd + 16);
  if (cdStart === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip: ZIP64 not supported');

  const out: ZipEntry[] = [];
  let p = cdStart;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip: bad central directory entry');
    const flags      = buf.readUInt16LE(p + 8);
    const method     = buf.readUInt16LE(p + 10);
    const compSize   = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen    = buf.readUInt16LE(p + 28);
    const extraLen   = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff   = buf.readUInt32LE(p + 42);
    const name       = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (flags & 0x1) throw new Error(`zip: entry "${name}" is encrypted`);

    if (buf.readUInt32LE(localOff) !== SIG_LOCAL) throw new Error(`zip: bad local header for "${name}"`);
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw       = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0)      data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`zip: unsupported compression method ${method} for "${name}"`);
    if (uncompSize !== 0xffffffff && data.length !== uncompSize) {
      throw new Error(`zip: size mismatch for "${name}" (${data.length} vs ${uncompSize})`);
    }
    out.push({ name, data, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** gunzip if the payload has a gzip magic, else return as-is. */
export function ungzipIfNeeded(buf: Buffer): Buffer {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  return buf;
}
