// store.ts — persistence and media helpers for Guides and GuideSteps.
//
// Extracted from routes/guides.ts so the ingestion service and the route layer
// can share them without a circular import. routes/guides.ts re-exports
// guideStore and guideStepStore, so existing importers are unaffected.

import fs    from 'fs';
import path  from 'path';
import https from 'https';
import http  from 'http';
import type { Guide, GuideStep } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

export const guideStore     = new JsonFileStore<Guide>('guides');
export const guideStepStore = new JsonFileStore<GuideStep>('guide-steps');

const DATA_DIR            = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
export const STEP_IMG_DIR = path.join(DATA_DIR, 'guide-step-images');
fs.mkdirSync(STEP_IMG_DIR, { recursive: true });

/** Timestamped filename, matching the historical `${guideId}_${stepId}_${stamp}.jpg` shape. */
export function stepImageFilename(guideId: string, stepId: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${guideId}_${stepId}_${stamp}.jpg`;
}

export function saveStepImage(guideId: string, stepId: string, base64: string): string {
  const filename = stepImageFilename(guideId, stepId);
  fs.writeFileSync(path.join(STEP_IMG_DIR, filename), Buffer.from(base64, 'base64'));
  return filename;
}

export function writeStepImageBuffer(guideId: string, stepId: string, buf: Buffer): string {
  const filename = stepImageFilename(guideId, stepId);
  fs.writeFileSync(path.join(STEP_IMG_DIR, filename), buf);
  return filename;
}

export function deleteStepImage(filename: string): void {
  try {
    fs.unlinkSync(path.join(STEP_IMG_DIR, filename));
  } catch { /* not present — ignore */ }
}

/**
 * Download a remote image URL and return its bytes.
 * Supports http and https, follows up to 3 redirects, and resolves null on any
 * network or HTTP error so callers can treat image failures as non-fatal.
 */
export function downloadUrl(url: string, redirectsLeft = 3): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15_000 }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
        resolve(downloadUrl(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        console.warn(`[SIB] Image download failed (${res.statusCode}): ${url}`);
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
