// chamber-configs.ts — C1 (2026.4.45): Chamber Configuration catalog.
//
//   GET    /chamber-configs            — list (any signed-in user; includes chamber counts)
//   POST   /chamber-configs            — engineer+: create { code, name, description? }
//   PATCH  /chamber-configs/:id        — engineer+: rename / re-code / describe
//   DELETE /chamber-configs/:id        — owner/manager: only when no anchor references it
//
// A configuration is a TYPE of chamber ("Producer XP · Cfg A"). Physical
// chambers (anchors / QRs) point at it via Anchor.configId. The app scopes
// authoring to a config and resolves an operator's config from the QR scan.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ChamberConfig, CreateChamberConfigRequest, UpdateChamberConfigRequest } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { anchorStore } from './anchors.js';
import { currentUamUser, uamIsActive } from '../middleware/auth.js';

export const chamberConfigStore = new JsonFileStore<ChamberConfig>('chamber-configs');

const router = Router();

const now = () => new Date().toISOString();

function isTechnician(req: Request): boolean {
  const actor = currentUamUser(req);
  return uamIsActive() && !!actor && actor.role === 'technician';
}

function codeTaken(code: string, exceptId?: string): boolean {
  const c = code.toLowerCase();
  return chamberConfigStore.findAll().some(x => x.id !== exceptId && x.code.toLowerCase() === c);
}

/** Config rows as the app/portal sees them: with the number of chambers assigned. */
function withCounts(list: ChamberConfig[]): Array<ChamberConfig & { chamberCount: number }> {
  const anchors = anchorStore.findAll();
  return list.map(c => ({ ...c, chamberCount: anchors.filter(a => a.configId === c.id).length }));
}

router.get('/', (_req: Request, res: Response) => {
  const list = chamberConfigStore.findAll()
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }));
  res.json({ data: withCounts(list), timestamp: now() });
});

router.get('/:id', (req: Request, res: Response) => {
  const c = chamberConfigStore.findById(req.params.id);
  if (!c) return res.status(404).json({ error: `Configuration ${req.params.id} not found`, timestamp: now() });
  return res.json({ data: withCounts([c])[0], timestamp: now() });
});

router.post('/', (req: Request, res: Response) => {
  if (isTechnician(req)) {
    return res.status(403).json({ error: 'Creating a configuration requires Engineer role or above', timestamp: now() });
  }
  const body = (req.body ?? {}) as CreateChamberConfigRequest;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!code || !name) return res.status(400).json({ error: 'code and name are required', timestamp: now() });
  if (code.length > 32) return res.status(400).json({ error: 'code must be ≤ 32 characters', timestamp: now() });
  if (codeTaken(code)) return res.status(409).json({ error: `A configuration with code "${code}" already exists`, timestamp: now() });
  const actor = currentUamUser(req);
  const cfg: ChamberConfig = {
    id: uuidv4(), code, name,
    ...(typeof body.description === 'string' && body.description.trim() ? { description: body.description.trim() } : {}),
    createdBy: (typeof body.createdBy === 'string' && body.createdBy.trim()) || actor?.name || undefined,
    createdAt: now(), updatedAt: now(),
  };
  chamberConfigStore.save(cfg);
  console.log(`[SIB] ChamberConfig created: ${cfg.code} (${cfg.id})`);
  return res.status(201).json({ data: { ...cfg, chamberCount: 0 }, timestamp: now() });
});

router.patch('/:id', (req: Request, res: Response) => {
  if (isTechnician(req)) {
    return res.status(403).json({ error: 'Editing a configuration requires Engineer role or above', timestamp: now() });
  }
  const c = chamberConfigStore.findById(req.params.id);
  if (!c) return res.status(404).json({ error: `Configuration ${req.params.id} not found`, timestamp: now() });
  const body = (req.body ?? {}) as UpdateChamberConfigRequest;
  const updated: ChamberConfig = { ...c, updatedAt: now() };
  if (typeof body.code === 'string') {
    const code = body.code.trim();
    if (!code || code.length > 32) return res.status(400).json({ error: 'code must be 1–32 characters', timestamp: now() });
    if (codeTaken(code, c.id)) return res.status(409).json({ error: `A configuration with code "${code}" already exists`, timestamp: now() });
    updated.code = code;
  }
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty', timestamp: now() });
    updated.name = name;
  }
  if ('description' in body) {
    const d = typeof body.description === 'string' ? body.description.trim() : '';
    if (d) updated.description = d; else delete updated.description;
  }
  chamberConfigStore.save(updated);
  return res.json({ data: withCounts([updated])[0], timestamp: now() });
});

router.delete('/:id', (req: Request, res: Response) => {
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role !== 'owner' && actor.role !== 'manager') {
    return res.status(403).json({ error: 'Deleting a configuration requires Manager or Owner', timestamp: now() });
  }
  const c = chamberConfigStore.findById(req.params.id);
  if (!c) return res.status(404).json({ error: `Configuration ${req.params.id} not found`, timestamp: now() });
  const inUse = anchorStore.findAll().filter(a => a.configId === c.id).length;
  if (inUse > 0) {
    return res.status(409).json({
      error: `"${c.code}" still has ${inUse} chamber(s) assigned — reassign them first`,
      timestamp: now(),
    });
  }
  chamberConfigStore.delete(c.id);
  return res.status(204).send();
});

export default router;
