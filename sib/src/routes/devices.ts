/**
 * Device routes - wearables and what they can deliver.
 *
 * GET /devices                → the profiles in docs/devices/*.md (no auth beyond the content gate)
 * GET /guides/:id/readiness   → lives in guides.ts; joins a guide's steps with these profiles
 *                               (docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from '../catalog/catalog-core.js';
import { profileFrom, type DeviceProfile } from '../guides/readiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function devicesDir(): string | null {
  const candidates = [path.join(__dirname, '../../../docs/devices'), path.join(process.cwd(), 'docs/devices'), path.join(process.cwd(), '../docs/devices')];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

/** Every valid profile, in file order; a malformed file is skipped with a console line, never a 500. */
export function readDeviceProfiles(): DeviceProfile[] {
  const dir = devicesDir(); if (!dir) return [];
  const out: DeviceProfile[] = [];
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md').sort()) {
    const parsed = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
    const p = parsed ? profileFrom(parsed.fm) : null;
    if (p) out.push(p); else console.warn(`[SIB] docs/devices/${name}: not a valid device profile - skipped`);
  }
  return out;
}

const router = Router();
router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data: readDeviceProfiles(), timestamp: new Date().toISOString() });
});
export default router;
