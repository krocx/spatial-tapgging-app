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

function hydrate(stored: StoredPassState): PassState {
  return {
    ...stored,
    images: stored.images.map((meta) => ({
      ...meta,
      imageBase64: readImageBlob(meta.id),
    })),
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
