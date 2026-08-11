// designer-images.ts — server-side store for images attached to procedure-map
// steps in the Procedure Designer.
//
// Why images don't live in the map: maps sync over WebSocket and snapshot up
// to 50 versions each — base64 payloads would bloat every collab frame and
// multiply through version history. So the canvas uploads once, the node keeps
// only a filename, and applyImportedGuide COPIES the file into the guide
// step-image store at export (no network hop — see ingest.ts).
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

/** JPEG magic bytes — the client always uploads JPEG (canvas re-encode). */
function looksLikeJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — generous for a 1024px JPEG

export class DesignerImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Store a base64 JPEG; returns the content-addressed filename. */
export function saveDesignerImage(base64: string): string {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0)       throw new DesignerImageError(400, 'Empty image payload');
  if (buf.length > MAX_BYTES) throw new DesignerImageError(413, 'Image too large — resize below 2 MB');
  if (!looksLikeJpeg(buf))    throw new DesignerImageError(415, 'Only JPEG images are accepted');

  const hash     = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
  const filename = `${hash}.jpg`;
  const full     = path.join(DESIGNER_IMG_DIR, filename);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return filename;
}

/**
 * Absolute path for a stored designer image, or null if absent/invalid.
 * The strict filename check is the path-traversal guard — filenames are
 * server-generated, so anything else is rejected outright.
 */
export function designerImagePath(filename: string): string | null {
  if (!/^[a-f0-9]{24}\.jpg$/.test(filename)) return null;
  const full = path.join(DESIGNER_IMG_DIR, filename);
  return fs.existsSync(full) ? full : null;
}
