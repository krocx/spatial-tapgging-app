import fs from 'fs';
import path from 'path';
import type { PassState, PassStateImage } from '@spatial/shared';
import { JsonFileStore } from './json-file-store.js';

// ── Why this file looks the way it does ─────────────────────────────────────
// Each PassState holds up to ~19 full base64-encoded JPEGs (one per honeycomb
// viewpoint). JsonFileStore (and the InMemoryStore it wraps) never evicts —
// every record loaded at startup, or saved since, stays resident in the
// process's memory for the life of the server. With every trained tag's
// full image set permanently in memory, this store alone could account for a
// large, ever-growing chunk of the 512MB Render instance's RAM — and every
// mutation to ANY pass-state re-serializes the entire store (all base64
// bytes, for every tag) to disk via JSON.stringify.
//
// Fix: keep only image *metadata* in the JsonFileStore record that lives in
// memory. The actual base64 bytes are written to their own file under
// pass-state-images/<imageId>.b64 and are read from disk on demand —
// only when a specific pass state is actually needed (train/validate/
// validate-all/GET) — rather than held in memory permanently.

const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const IMAGE_DIR = path.join(DATA_DIR, 'pass-state-images');

function imageBlobPath(imageId: string): string {
  return path.join(IMAGE_DIR, `${imageId}.b64`);
}

function writeImageBlob(imageId: string, base64: string): void {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.writeFileSync(imageBlobPath(imageId), base64, 'utf8');
}

function readImageBlob(imageId: string): string {
  return fs.readFileSync(imageBlobPath(imageId), 'utf8');
}

function deleteImageBlob(imageId: string): void {
  try {
    fs.unlinkSync(imageBlobPath(imageId));
  } catch {
    // Already gone — nothing to do.
  }
}

// What actually lives in the JsonFileStore's in-memory Map: everything about
// a PassState except the (large) imageBase64 payloads.
type StoredPassStateImage = Omit<PassStateImage, 'imageBase64'>;
type StoredPassState = Omit<PassState, 'images'> & { images: StoredPassStateImage[] };

const metaStore = new JsonFileStore<StoredPassState>('pass-states');

// ── One-time migration for pre-refactor data ────────────────────────────────
// pass-states.json records written before this store split out image blobs
// still have `imageBase64` embedded inline on each image entry (TS types are
// erased at runtime, so old JSON on disk doesn't match StoredPassState — it
// matches the old, fatter shape). Without this migration, hydrate() would try
// to read a blob file that was never written for those images and throw
// ENOENT on every read. Walk the metadata once at startup, write out any
// inline bytes as blobs, and rewrite the record without them so the store
// converges to the new on-disk shape permanently (this only does real work
// once — after the first run, every record has been stripped).
function migrateLegacyInlineImages(): void {
  let migrated = 0;
  for (const stored of metaStore.findAll()) {
    const hasInline = stored.images.some(
      (img) => typeof (img as Partial<PassStateImage>).imageBase64 === 'string',
    );
    if (!hasInline) continue;

    const cleanedImages = stored.images.map((img) => {
      const { imageBase64, ...meta } = img as PassStateImage;
      if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
        writeImageBlob(meta.id, imageBase64);
      }
      return meta;
    });
    metaStore.save({ ...stored, images: cleanedImages });
    migrated++;
  }
  if (migrated > 0) {
    console.log(`[SIB] Migrated ${migrated} legacy pass-state(s) to on-disk image blobs`);
  }
}
migrateLegacyInlineImages();

function hydrate(stored: StoredPassState): PassState {
  return {
    ...stored,
    images: stored.images.map((meta) => {
      try {
        return { ...meta, imageBase64: readImageBlob(meta.id) };
      } catch (err) {
        // Defensive fallback — should be unreachable after migration, but
        // avoids a hard crash (and the resulting request failures we saw)
        // if a blob is ever missing for any other reason.
        const inline = (meta as Partial<PassStateImage>).imageBase64;
        if (typeof inline === 'string') return { ...meta, imageBase64: inline };
        console.error(`[SIB] Missing image blob for ${meta.id}:`, err);
        return { ...meta, imageBase64: '' };
      }
    }),
  };
}

function strip(passState: PassState): StoredPassState {
  // Persist bytes to disk first, then return the lightweight record that
  // will actually be kept in memory / written to pass-states.json.
  for (const img of passState.images) {
    writeImageBlob(img.id, img.imageBase64);
  }
  return {
    ...passState,
    images: passState.images.map(({ imageBase64, ...meta }) => meta),
  };
}

export const passStateStore = {
  save(passState: PassState): PassState {
    metaStore.save(strip(passState));
    return passState;
  },

  findAll(): PassState[] {
    return metaStore.findAll().map(hydrate);
  },

  findById(id: string): PassState | undefined {
    const stored = metaStore.findById(id);
    return stored ? hydrate(stored) : undefined;
  },

  delete(id: string): boolean {
    const stored = metaStore.findById(id);
    if (stored) {
      for (const img of stored.images) deleteImageBlob(img.id);
    }
    return metaStore.delete(id);
  },
};

export function findPassStateByTag(tagId: string): PassState | undefined {
  const stored = metaStore.findAll().find((p) => p.tagId === tagId);
  return stored ? hydrate(stored) : undefined;
}

// Lightweight existence check — used anywhere we only need to know
// "is this tag trained?" (e.g. the tags list's isTrained flag). Deliberately
// does NOT hydrate image bytes: calling findPassStateByTag for that purpose
// was reading every honeycomb image (up to 19 per tag) into memory just to
// throw the result away, which is what was driving the server back into OOM.
export function hasPassStateForTag(tagId: string): boolean {
  return metaStore.findAll().some((p) => p.tagId === tagId);
}
