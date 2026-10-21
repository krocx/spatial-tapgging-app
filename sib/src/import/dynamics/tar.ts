// tar.ts - read a `.guide` package: a plain, uncompressed POSIX tar, flat.
//
// The file is untrusted input. Everything that could hurt is refused up
// front: absolute paths, `..`, any `/` at all (a package has no
// subdirectories), symlinks, hardlinks, devices, oversize entries, too many
// entries, and a header that does not add up. Entries are read in memory -
// a guide is tens of MB at most - and nothing is written to disk here.
//
// Proprietary & Confidential · Applied Materials.

export interface TarEntry { name: string; bytes: Buffer }

export interface TarLimits {
  maxEntries:      number;   // default 2 000
  maxEntryBytes:   number;   // default 512 MB
  maxTotalBytes:   number;   // default 1.5 GB
}
export const DEFAULT_TAR_LIMITS: TarLimits = { maxEntries: 2000, maxEntryBytes: 512 * 1024 * 1024, maxTotalBytes: 1536 * 1024 * 1024 };

export class TarError extends Error { constructor(msg: string) { super(msg); this.name = 'TarError'; } }

const BLOCK = 512;

function cstr(buf: Buffer, off: number, len: number): string {
  const slice = buf.subarray(off, off + len);
  const nul = slice.indexOf(0);
  return (nul >= 0 ? slice.subarray(0, nul) : slice).toString('utf8');
}
function octal(buf: Buffer, off: number, len: number): number {
  const s = cstr(buf, off, len).trim();
  if (!s) return 0;
  // GNU base-256 for big sizes: first byte 0x80
  if (buf[off] === 0x80) { let v = 0; for (let i = 1; i < len; i++) v = v * 256 + buf[off + i]; return v; }
  if (!/^[0-7]+$/.test(s)) throw new TarError('tar header has a non-octal number');
  return parseInt(s, 8);
}

/** Entry names a package may carry: no path separators, no traversal, printable. */
export function safeEntryName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..' || name.startsWith('..')) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  return true;
}

/** Read every regular file in the archive. Throws TarError on anything unsafe or malformed. */
export function readTar(input: Buffer, limits: TarLimits = DEFAULT_TAR_LIMITS): TarEntry[] {
  if (input.length < BLOCK) throw new TarError('not a tar archive (too short)');
  const out: TarEntry[] = [];
  let off = 0, total = 0, count = 0;
  let longName: string | null = null;
  while (off + BLOCK <= input.length) {
    const hdr = input.subarray(off, off + BLOCK);
    if (hdr.every(b => b === 0)) break;                       // end-of-archive zero block
    const magic = cstr(hdr, 257, 6);
    if (magic !== 'ustar' && magic !== 'ustar ' && magic !== '') throw new TarError('not a tar archive (bad magic)');
    // checksum: sum of header bytes with the checksum field as spaces
    let sum = 0; for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 32 : hdr[i];
    const stored = octal(hdr, 148, 8);
    if (sum !== stored) throw new TarError('tar header checksum mismatch');
    let name = cstr(hdr, 0, 100);
    const prefix = magic.startsWith('ustar') ? cstr(hdr, 345, 155) : '';
    if (prefix) name = prefix + '/' + name;
    const size = octal(hdr, 124, 12);
    const type = String.fromCharCode(hdr[156] || 0x30);
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (size < 0 || dataEnd > input.length) throw new TarError('tar entry runs past the end of the archive');
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    off = dataStart + padded;

    if (type === 'L') {                                        // GNU long name - the next entry's name
      longName = cstr(input, dataStart, size);
      continue;
    }
    if (longName) { name = longName; longName = null; }
    if (type === '5') { if (name.replace(/\/+$/, '')) throw new TarError('a package has no directories'); continue; }
    if (type === '1' || type === '2') throw new TarError('links are not allowed in a package');
    if (type === '3' || type === '4' || type === '6') throw new TarError('device and fifo entries are not allowed');
    if (type === 'x' || type === 'g') continue;                 // pax headers: ignored (names we accept fit in 100 chars anyway)
    if (type !== '0' && type !== '\0' && type !== '7') throw new TarError(`unsupported tar entry type "${type}"`);
    if (!safeEntryName(name)) throw new TarError('entry name is not allowed (path, traversal or control characters)');
    if (size > limits.maxEntryBytes) throw new TarError('an entry exceeds the size limit');
    total += size; count++;
    if (total > limits.maxTotalBytes) throw new TarError('the package exceeds the total size limit');
    if (count > limits.maxEntries) throw new TarError('the package has too many entries');
    out.push({ name, bytes: input.subarray(dataStart, dataEnd) });
  }
  return out;
}

// ── Entry names ──────────────────────────────────────────────────────────────

export type EntryKind = 'Guide_Manifest' | 'Guide_Body' | 'Metadata' | 'Model' | 'Image' | 'Video' | 'Audio' | 'Unknown';
export type EntryPart = 'Body' | 'SmallThumbnail' | 'Metadata';

export interface ParsedEntryName {
  kind:   EntryKind;
  /** For Metadata_<guid>, Model_Body_<guid>_<etag>, … */
  part?:  EntryPart;
  guid?:  string;
  etag?:  string;        // URL-encoded W/"<version>" as it appears, e.g. W%2F%2212345%22
  raw:    string;
}

const GUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ASSET_RE = new RegExp(`^(?<kind>[A-Za-z]+)_(?<part>Body|SmallThumbnail)_(?<guid>${GUID})_(?<etag>.+)$`);
const META_RE  = new RegExp(`^Metadata_(?<guid>${GUID})$`);

export function parseEntryName(name: string): ParsedEntryName {
  if (name === 'Guide_Manifest') return { kind: 'Guide_Manifest', raw: name };
  if (name === 'Guide_Body') return { kind: 'Guide_Body', raw: name };
  const m = META_RE.exec(name);
  if (m?.groups) return { kind: 'Metadata', part: 'Metadata', guid: m.groups.guid.toLowerCase(), raw: name };
  const a = ASSET_RE.exec(name);
  if (a?.groups) {
    const k = a.groups.kind;
    const kind: EntryKind = k === 'Model' || k === 'Image' || k === 'Video' || k === 'Audio' ? k : 'Unknown';
    return { kind, part: a.groups.part as EntryPart, guid: a.groups.guid.toLowerCase(), etag: a.groups.etag, raw: name };
  }
  return { kind: 'Unknown', raw: name };
}

/** The ETag as Dataverse writes it: W/"12345" from W%2F%2212345%22. */
export function decodeEtag(etag: string | undefined): string | undefined {
  if (!etag) return undefined;
  try { return decodeURIComponent(etag); } catch { return etag; }
}
