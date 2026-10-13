/**
 * Guide lifecycle (2026.4.50, docs/GUIDE-LIFECYCLE-REVIEW.md).
 *
 *   draft → published → archived → deleted (30-day trash) → purged
 *
 * Archive hides a guide from Operator and the library's default view and
 * keeps everything. Delete moves the guide and what belongs to it (steps,
 * the designer map with versions and access, the cone-training tags) into a
 * trash item that an Owner can restore for 30 days; runs, evidence and the
 * usage log are live data and are never moved. Purge removes the item and
 * the files that only it referenced (step images, pass-state images).
 * Every transition writes one audit line to the ops log.
 */
import type { Guide, GuideStep, GuideTrashItem, Tag } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { guideStore, guideStepStore, deleteStepImage } from './store.js';
import { mindmapStore, mindmapVersionStore, mindmapAccessStore } from '../models/mindmap.model.js';
import { boundGuideId } from '../procedure/export.js';
import { tagStore } from '../routes/tags.js';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';
import { guideSessionStore } from '../routes/guide-sessions.js';
import { omsUsageStore } from '../oms/usage-log.js';
import { logOpsEvent } from '../ops-log.js';

export const TRASH_DAYS = 30;
export const guideTrashStore = new JsonFileStore<GuideTrashItem>('guide-trash');

const now = () => new Date().toISOString();
const audit = (what: string, by: string, detail: string) => logOpsEvent({ method: 'LIFECYCLE', path: what, outcome: 'allowed', detail: `${detail} · by ${by}` });

/** Sessions ever recorded against a guide (sign-off sessions + usage rows). */
export function runsOf(guideId: string): number {
  return guideSessionStore.findAll().filter(s => s.guideId === guideId).length + omsUsageStore.findAll().filter(r => r.guideId === guideId).length;
}
export function linkedMap(guideId: string) {
  const maps = mindmapStore.findAll();
  return maps.find(m => m.guideSync?.guideId === guideId) ?? maps.find(m => boundGuideId(m) === guideId);
}

export function archiveGuide(guide: Guide, by: string, archive: boolean): Guide {
  const updated: Guide = { ...guide, updatedAt: now() };
  if (archive) { updated.archivedAt = now(); updated.archivedBy = by; updated.published = false; }
  else { delete updated.archivedAt; delete updated.archivedBy; }
  guideStore.save(updated);
  audit(archive ? 'guide:archive' : 'guide:restore', by, `${guide.name} (${guide.id})`);
  return updated;
}

/** Delete = move to the trash. Runs stay. Returns the trash item. */
export function trashGuide(guide: Guide, by: string, opts: { deleteImportLog?: (id: string) => void } = {}): GuideTrashItem {
  const steps = guideStepStore.findAll().filter(s => s.guideId === guide.id);
  const tagIds = steps.map(s => s.validationTagId).filter((t): t is string => !!t);
  const tags = tagIds.map(id => tagStore.findById(id)).filter((t): t is Tag => !!t);
  const map = linkedMap(guide.id);
  const item: GuideTrashItem = {
    id: guide.id, name: guide.name, deletedAt: now(), deletedBy: by, expiresAt: new Date(Date.now() + TRASH_DAYS * 86400_000).toISOString(),
    runs: runsOf(guide.id), guide, steps, tags,
    ...(map ? { map, mapVersions: mindmapVersionStore.findAll().filter(v => v.mapId === map.id), mapAccess: mindmapAccessStore.findById(map.id) ?? undefined } : {}),
  };
  guideTrashStore.save(item);
  for (const s of steps) guideStepStore.delete(s.id);
  for (const t of tags) tagStore.delete(t.id);
  if (map) { mindmapStore.delete(map.id); mindmapVersionStore.pruneWhere(v => v.mapId === map.id); mindmapAccessStore.delete(map.id); }
  guideStore.delete(guide.id);
  opts.deleteImportLog?.(guide.id);
  audit('guide:delete', by, `${guide.name} (${guide.id}) → trash until ${item.expiresAt.slice(0, 10)} · ${steps.length} steps · ${item.runs} runs kept${map ? ' · map' : ''}`);
  return item;
}

export function restoreGuide(id: string, by: string): Guide | null {
  const item = guideTrashStore.findById(id); if (!item) return null;
  guideStore.save({ ...item.guide, updatedAt: now() });
  for (const s of item.steps) guideStepStore.save(s);
  for (const t of item.tags) tagStore.save(t);
  if (item.map) {
    mindmapStore.save(item.map as Parameters<typeof mindmapStore.save>[0]);
    for (const v of item.mapVersions ?? []) mindmapVersionStore.save(v as Parameters<typeof mindmapVersionStore.save>[0]);
    if (item.mapAccess) mindmapAccessStore.save(item.mapAccess as Parameters<typeof mindmapAccessStore.save>[0]);
  }
  guideTrashStore.delete(id);
  audit('guide:restore-from-trash', by, `${item.name} (${id})`);
  return item.guide;
}

/** Purge one trash item and the files only it referenced. */
export function purgeTrash(id: string, by: string): boolean {
  const item = guideTrashStore.findById(id); if (!item) return false;
  for (const s of item.steps) if (s.mediaPath) deleteStepImage(s.mediaPath);
  for (const t of item.tags) for (const kind of ['PASS', 'FAIL'] as const) { const ps = findPassStateByTag(t.id, kind); if (ps) passStateStore.delete(ps.id); }
  guideTrashStore.delete(id);
  audit('guide:purge', by, `${item.name} (${id})`);
  return true;
}
export function purgeExpiredTrash(): number {
  const t = now(); let n = 0;
  for (const item of guideTrashStore.findAll()) if (item.expiresAt < t && purgeTrash(item.id, 'scheduler')) n++;
  return n;
}

/** Dangling references, for the admin page - reported, never auto-fixed. */
export function integrityReport() {
  const guides = new Set(guideStore.findAll().map(g => g.id));
  const trash = new Set(guideTrashStore.findAll().map(t => t.id));
  const missing = (id: string) => !guides.has(id);
  const maps = mindmapStore.findAll().filter(m => { const g = m.guideSync?.guideId ?? boundGuideId(m); return g && missing(g); }).map(m => ({ mapId: m.id, name: m.name, guideId: m.guideSync?.guideId ?? boundGuideId(m), inTrash: trash.has(m.guideSync?.guideId ?? boundGuideId(m) ?? '') }));
  const sessions = guideSessionStore.findAll().filter(s => missing(s.guideId)).map(s => ({ sessionId: s.id, guideId: s.guideId, guideName: s.guideName, inTrash: trash.has(s.guideId) }));
  const usage = omsUsageStore.findAll().filter(r => missing(r.guideId)).length;
  const steps = guideStepStore.findAll().filter(s => missing(s.guideId)).map(s => ({ stepId: s.id, guideId: s.guideId }));
  return { generatedAt: now(), trashDays: TRASH_DAYS, trash: guideTrashStore.findAll().map(t => ({ id: t.id, name: t.name, deletedAt: t.deletedAt, deletedBy: t.deletedBy, expiresAt: t.expiresAt, runs: t.runs, steps: t.steps.length, hasMap: !!t.map })), orphanMaps: maps, sessionsWithoutGuide: sessions, usageRowsWithoutGuide: usage, orphanSteps: steps };
}
