// designer-images.ts - server-side store for images attached to procedure-map
// steps in the Procedure Designer.
//
// Why images don't live in the map: maps sync over WebSocket and snapshot up
// to 50 versions each - base64 payloads would bloat every collab frame and
// multiply through version history. So the canvas uploads once, the node keeps
// only a filename, and applyImportedGuide COPIES the file into the guide
// step-image store at export (no network hop - see ingest.ts).
//
// Files are content-addressed by hash, so re-uploading the same image (or the
// same image attached to several steps) stores one file, and re-saves are
// idempotent. No delete endpoint on purpose: files are tiny (client downsizes
// to ~1024px JPEG), references live in map metadata/version history where they
// may resurface via restore, and orphan cleanup is a maintenance script's job,
// not a request handler's.

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
export const DESIGNER_IMG_DIR = path.join(DATA_DIR, 'designer-images');
fs.mkdirSync(DESIGNER_IMG_DIR, { recursive: true });

/** JPEG magic bytes - the canvas uploads JPEG (client re-encode). */
function looksLikeJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
/** PNG magic bytes - step pictures copied from an imported guide (Dynamics 365 Guides exports PNG). */
function looksLikePng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB - generous for a 1024px JPEG
/** Copies of a guide's own step pictures (imports ship full-size PNG screenshots). */
export const GUIDE_COPY_MAX_BYTES = 8 * 1024 * 1024;

export class DesignerImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Store a base64 JPEG or PNG; returns the content-addressed filename (extension says which). */
export function saveDesignerImage(base64: string, limitBytes = MAX_BYTES): string {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0)       throw new DesignerImageError(400, 'Empty image payload');
  if (buf.length > limitBytes) throw new DesignerImageError(413, `Image too large - resize below ${Math.round(limitBytes / 1048576)} MB`);
  const ext = looksLikeJpeg(buf) ? 'jpg' : looksLikePng(buf) ? 'png' : null;
  if (!ext)                   throw new DesignerImageError(415, 'Only JPEG or PNG images are accepted');

  const hash     = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
  const filename = `${hash}.${ext}`;
  const full     = path.join(DESIGNER_IMG_DIR, filename);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return filename;
}

/**
 * Absolute path for a stored designer image, or null if absent/invalid.
 * The strict filename check is the path-traversal guard - filenames are
 * server-generated, so anything else is rejected outright.
 */
export function designerImagePath(filename: string): string | null {
  if (!/^[a-f0-9]{24}\.(jpg|png)$/.test(filename)) return null;
  const full = path.join(DESIGNER_IMG_DIR, filename);
  return fs.existsSync(full) ? full : null;
}
