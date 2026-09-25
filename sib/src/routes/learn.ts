/**
 * Learn routes — /learn, the five-minute reading orders.
 *
 * GET /learn        → the page (sib/portal/learn.html, single file, brand system)
 * GET /learn/data   → docs/learn/journeys.json joined with the catalogue: every
 *                     stop carries its feature's name, area, product colour key,
 *                     status and diagram (arch, else flow, else the area flow),
 *                     redacted exactly as /catalog/data redacts it for callers
 *                     without the IP key. The catalogue stays the source of
 *                     truth; this endpoint only arranges it in reading order.
 *
 * No auth — read-only documentation, same access model as /catalog.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readCatalog } from './catalog.js';
import { redactFeature } from '../catalog/catalog-core.js';
import { canViewRestricted } from '../middleware/auth.js';
import { PLATFORM_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Stop  { feature: string; title: string; text: string; try?: string }
interface Quiz  { q: string; options: string[]; answer: number }
interface Journey { id: string; area: string; name: string; question: string; minutes: number; stops: Stop[]; quiz: Quiz[] }

export function readJourneys(docsDir: string): Journey[] {
  const p = path.join(docsDir, 'learn', 'journeys.json');
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { journeys?: Journey[] };
  return Array.isArray(raw.journeys) ? raw.journeys : [];
}

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../../portal/learn.html'));
});

router.get('/data', (req: Request, res: Response) => {
  const cat = readCatalog();
  if (!cat) return res.status(404).json({ error: 'Catalogue not available on this deployment' });
  const unlocked = canViewRestricted(req);
  const features = new Map(cat.data.features.map(f => [f.id, unlocked ? f : redactFeature(f)]));
  const areas    = new Map(cat.data.areas.map(a => [a.id, a]));
  const journeys = readJourneys(cat.docsDir).map(j => ({
    ...j,
    areaName: areas.get(j.area)?.name ?? j.area,
    stops: j.stops.map(s => {
      const f = features.get(s.feature);
      return {
        ...s,
        name:     f?.name ?? s.feature,
        area:     f?.area ?? j.area,
        status:   f?.status,
        locked:   !!f?.locked,
        // The diagram the stop shows: the feature's own architecture, else its
        // flow, else the area's flow — never nothing.
        diagram:  f?.locked ? null : (f?.arch || f?.flow || areas.get(f?.area ?? j.area)?.flow || null),
        catalog:  `/catalog#${s.feature}`,
      };
    }),
  }));
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({ version: PLATFORM_VERSION, journeys, timestamp: new Date().toISOString() });
});

export default router;
