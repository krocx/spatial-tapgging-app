// anchor-accuracy.ts — Anchor Lab samples (2026.4.46).
//
// A tester marks where a tag's physical feature REALLY is; the app sends the
// rendered-vs-physical error with the session's context (device, origin
// source, relocalization / convergence times, light, approach angle). One
// JSONL file per anchor under DATA_DIR/accuracy — append-only, tiny, no
// images, no keys. The summary is what the portal charts and what the
// home-testing protocol compares run against run (docs/ANCHOR-LAB.md).

import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AnchorAccuracySample, AnchorAccuracySummary, AnchorAccuracyBucket, AnchorOriginSource } from '@spatial/shared';

const DATA_DIR     = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const ACCURACY_DIR = path.join(DATA_DIR, 'accuracy');

const ORIGINS: ReadonlySet<string> = new Set<AnchorOriginSource>(['sealed', 'qr', 'object', 'approximate']);
const MAX_SAMPLES = 5000;   // per anchor; older lines are dropped on append

const filePath = (anchorId: string) => path.join(ACCURACY_DIR, `${anchorId}.jsonl`);

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown, max = 120): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Validate + normalise a posted sample. Returns an error string when unusable. */
export function sanitizeAccuracySample(anchorId: string, body: unknown): AnchorAccuracySample | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const tagId = str(b.tagId, 80);
  if (!tagId) return 'tagId is required';
  const errorMm = num(b.errorMm);
  if (errorMm === undefined || errorMm < 0 || errorMm > 10_000) return 'errorMm must be a number in 0…10000';
  const originSource = typeof b.originSource === 'string' && ORIGINS.has(b.originSource) ? b.originSource as AnchorOriginSource : undefined;
  if (!originSource) return `originSource must be one of ${[...ORIGINS].join(', ')}`;
  const at = str(b.at, 40);
  const s: AnchorAccuracySample = {
    id: randomUUID(),
    anchorId,
    tagId,
    errorMm: Math.round(errorMm * 10) / 10,
    originSource,
    at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
  };
  const opt: Array<[keyof AnchorAccuracySample, unknown]> = [
    ['tagLabel', str(b.tagLabel)], ['dxMm', num(b.dxMm)], ['dyMm', num(b.dyMm)], ['dzMm', num(b.dzMm)],
    ['distanceM', num(b.distanceM)], ['relocalizeS', num(b.relocalizeS)], ['convergeS', num(b.convergeS)],
    ['qrDriftMm', num(b.qrDriftMm)], ['qrDriftDeg', num(b.qrDriftDeg)], ['lightLux', num(b.lightLux)],
    ['approachDeg', num(b.approachDeg)], ['device', str(b.device, 40)], ['osVersion', str(b.osVersion, 40)],
    ['appVersion', str(b.appVersion, 40)], ['run', str(b.run, 80)], ['by', str(b.by, 80)],
  ];
  for (const [k, v] of opt) if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = v;
  return s;
}

export function appendAccuracySample(sample: AnchorAccuracySample): void {
  fs.mkdirSync(ACCURACY_DIR, { recursive: true });
  const p = filePath(sample.anchorId!);
  fs.appendFileSync(p, JSON.stringify(sample) + '\n');
  // Keep the file bounded — a lab that runs for months must not grow forever.
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  if (lines.length > MAX_SAMPLES) fs.writeFileSync(p, lines.slice(-MAX_SAMPLES).join('\n') + '\n');
}

export function listAccuracySamples(anchorId: string): AnchorAccuracySample[] {
  const p = filePath(anchorId);
  if (!fs.existsSync(p)) return [];
  const out: AnchorAccuracySample[] = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as AnchorAccuracySample); } catch { /* skip a torn line */ }
  }
  return out;
}

export function deleteAccuracySamples(anchorId: string): boolean {
  const p = filePath(anchorId);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

/** Count of samples without reading them all into memory twice (card badge). */
export function accuracyCount(anchorId: string): number {
  return listAccuracySamples(anchorId).length;
}

// ── Summary (pure) ────────────────────────────────────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(v * 10) / 10;
}

function bucket(key: string, samples: AnchorAccuracySample[]): AnchorAccuracyBucket {
  const s = samples.map(x => x.errorMm).sort((a, b) => a - b);
  return { key, n: s.length, medianMm: quantile(s, 0.5), p90Mm: quantile(s, 0.9), maxMm: s.length ? s[s.length - 1] : 0 };
}

function groupBy(samples: AnchorAccuracySample[], key: (s: AnchorAccuracySample) => string): AnchorAccuracyBucket[] {
  const m = new Map<string, AnchorAccuracySample[]>();
  for (const s of samples) { const k = key(s); (m.get(k) ?? m.set(k, []).get(k)!).push(s); }
  return [...m.entries()].map(([k, v]) => bucket(k, v)).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function summariseAccuracy(samples: AnchorAccuracySample[]): AnchorAccuracySummary {
  const all = bucket('all', samples);
  const lastAt = samples.reduce<string | undefined>((acc, s) => (s.at && (!acc || s.at > acc) ? s.at : acc), undefined);
  return {
    n: all.n, medianMm: all.medianMm, p90Mm: all.p90Mm, maxMm: all.maxMm,
    byDevice: groupBy(samples, s => s.device ?? 'unknown'),
    byOrigin: groupBy(samples, s => s.originSource),
    byRun:    groupBy(samples.filter(s => s.run), s => s.run!),
    ...(lastAt && { lastAt }),
  };
}
