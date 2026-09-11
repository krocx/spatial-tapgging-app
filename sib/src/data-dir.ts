// data-dir.ts — ONE data root for everything SIB writes to disk.
//
// History: the JSON stores, world maps, inspection evidence, 3D models and QR
// images always lived under SIB_DATA_DIR (default .sib-data). A second root,
// DATA_DIR (default ./data), crept in for guide-session evidence, step
// validation references and platform media. Render sets both; the company
// server sets only SIB_DATA_DIR — so guide evidence landed in ./data INSIDE
// the git checkout, outside every backup, and vanished whenever the checkout
// was touched (2026.4.46 fix).
//
// Resolution order, first match wins:
//   1. DATA_DIR        — explicit override (Render keeps working unchanged)
//   2. SIB_DATA_DIR    — the store root; evidence now sits beside the stores
//   3. ./data          — the historical default (dev only)
//
// LEGACY_DATA_DIR is the pre-fix location (./data relative to cwd). Readers
// fall back to it so evidence written before the fix keeps displaying; a
// startup notice tells the operator to move it. Nothing is ever written there.

import fs from 'fs';
import path from 'path';

export const DATA_DIR: string =
  process.env.DATA_DIR ?? process.env.SIB_DATA_DIR ?? './data';

export const LEGACY_DATA_DIR: string = path.resolve('./data');

/** True when the legacy root is a different directory that still has files. */
export function legacyDataDirInUse(): boolean {
  try {
    if (path.resolve(DATA_DIR) === LEGACY_DATA_DIR) return false;
    return fs.existsSync(LEGACY_DATA_DIR) && fs.readdirSync(LEGACY_DATA_DIR).length > 0;
  } catch { return false; }
}

/** Resolve a data-relative path for READING: current root first, then the
 *  legacy root. Returns the first path that exists, else the current-root
 *  path (so callers' own 404 handling is unchanged). */
export function resolveDataFile(...rel: string[]): string {
  const current = path.join(DATA_DIR, ...rel);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(LEGACY_DATA_DIR, ...rel);
  if (path.resolve(DATA_DIR) !== LEGACY_DATA_DIR && fs.existsSync(legacy)) return legacy;
  return current;
}

let noticed = false;
/** One-time startup notice when pre-fix evidence is still in ./data. */
export function noticeLegacyDataDir(log: (msg: string) => void = console.warn): void {
  if (noticed) return;
  noticed = true;
  if (legacyDataDirInUse()) {
    log(`[SIB] Legacy data folder still in use: ${LEGACY_DATA_DIR} — files there are read but never written or backed up. Move its contents into ${path.resolve(DATA_DIR)} and delete it.`);
  }
}
