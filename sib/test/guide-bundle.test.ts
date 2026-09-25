// guide-bundle.test.ts - B1: the Guide Bundle is built from stores and
// conforms to docs/schema/guide-bundle.schema.json. The checker below is a
// small own-code subset of JSON Schema (type / required / properties / enum /
// const / items / minItems / maxItems / $ref within $defs) - enough to keep
// the contract honest without a validator dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Anchor, Guide, GuideStep, Model3D } from '@spatial/shared';
import { buildGuideBundle, BUNDLE_SCHEMA } from '../src/guides/bundle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = [path.join(here, '../../docs/schema/guide-bundle.schema.json'), path.join(here, '../../../docs/schema/guide-bundle.schema.json')]
  .find(p => fs.existsSync(p))!;
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

type S = Record<string, any>;
function check(value: unknown, s: S, at: string, errors: string[]): void {
  if (s.$ref) { const key = String(s.$ref).replace('#/$defs/', ''); return check(value, schema.$defs[key], at, errors); }
  if ('const' in s && value !== s.const) errors.push(`${at}: expected const ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(s.enum)}`);
  if (s.type) {
    const t = s.type;
    const ok = t === 'array' ? Array.isArray(value)
      : t === 'integer' ? Number.isInteger(value)
      : t === 'object' ? (typeof value === 'object' && value !== null && !Array.isArray(value))
      : typeof value === t;
    if (!ok) { errors.push(`${at}: expected ${t}, got ${Array.isArray(value) ? 'array' : typeof value}`); return; }
  }
  if (s.type === 'number' || s.type === 'integer') {
    if (s.minimum !== undefined && (value as number) < s.minimum) errors.push(`${at}: below minimum`);
    if (s.maximum !== undefined && (value as number) > s.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${at}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${at}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => check(v, s.items, `${at}[${i}]`, errors));
  }
  if (s.type === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in obj)) errors.push(`${at}: missing required '${r}'`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in obj) check(obj[k], sub as S, `${at}.${k}`, errors);
  }
}

const now = '2026-09-20T10:00:00.000Z';
const anchor: Anchor = { id: 'anc-1', assetId: 'Chamber-07', anchorType: 'QR', qrSizeCm: 12, configId: 'cfg-1', createdAt: now, updatedAt: now } as Anchor;
const model = (id: string, hasGLB = true): Model3D => ({
  id, name: `Model ${id}`, originalFormat: 'glb', originalFilename: `${id}.glb`, fileSizeBytes: 1234, status: 'ready',
  hasGLB, hasUSDZ: false, defaultScale: 0.58, createdAt: now, updatedAt: now,
} as Model3D);
const guide: Guide = {
  id: 'g-1', anchorId: 'anc-1', name: 'Steering install', published: true, createdAt: now, updatedAt: now,
  assembly: { modelId: 'm-asm', source: 'cortona', animationSpeed: 0.5,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1], source: 'tap' },
    initialNodes: [{ node: 'cmp:STEM', show: 'hidden' }], bounds: { min: [-1, 0, -1], max: [1, 1, 1] } },
} as Guide;
const step = (n: number, extra: Partial<GuideStep> = {}): GuideStep => ({
  id: `s-${n}`, guideId: 'g-1', anchorId: 'anc-1', sequenceNumber: n, text: `Step ${n}`, createdAt: now, updatedAt: now, ...extra,
} as GuideStep);
const steps = [
  step(2, { models: [{ slotId: 'assembly', modelId: 'm-asm' }, { slotId: 'tool', modelId: 'm-tool' }], validationRequired: true, validationTrainedAt: now }),
  step(1, { nodes: [{ node: 'cmp:STEM', show: 'solid', delaySec: 0.1, durationSec: 0.4 }, { node: 'cmp:STEM', effect: 'flash', delaySec: 1.5, durationSec: 2.5 }],
            view: { position: [0, 1, 2], orientation: [0, 1, 0, 0.3] }, cadPosition: [0.1, 0.2, 0.3], modelId: 'm-missing' }),
  step(3, { validationRequired: true }),
];

const lookups = {
  anchor: (id: string) => id === 'anc-1' ? anchor : undefined,
  model:  (id: string) => id === 'm-asm' ? model('m-asm') : id === 'm-tool' ? model('m-tool') : undefined,
  anchorWorldMap: () => ({ sealed: true, anchorPose: Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)), capturedAt: now }),
  anchorObject: () => ({ available: true, calibrated: false }),
  guideWorldMap: () => ({ available: true, photo: true, referenceCameraPose: Array(16).fill(0) }),
  now: () => now,
};

test('bundle conforms to the JSON Schema', () => {
  const b = buildGuideBundle(guide, steps, lookups);
  const errors: string[] = [];
  check(b, schema, '$', errors);
  assert.deepEqual(errors, []);
  assert.equal(b.schema, BUNDLE_SCHEMA);
  assert.equal(schema.properties.schema.const, BUNDLE_SCHEMA, 'schema file and code must agree on the version');
});

test('steps are ordered, models deduped with the assembly first, missing models skipped', () => {
  const b = buildGuideBundle(guide, steps, lookups);
  assert.deepEqual(b.steps.map(s => s.id), ['s-1', 's-2', 's-3']);
  assert.deepEqual(b.models.map(m => [m.id, m.role, m.glbUrl]), [['m-asm', 'assembly', '/models/m-asm/file.glb'], ['m-tool', 'step', '/models/m-tool/file.glb']]);
});

test('frames report what the anchor offers, with marker size in metres', () => {
  const b = buildGuideBundle(guide, steps, lookups);
  assert.equal(b.anchor.frames.qr.markerSizeM, 0.12);
  assert.equal(b.anchor.frames.qr.anchorPose?.length, 16);
  assert.equal(b.anchor.frames.worldMap.url, '/anchors/anc-1/worldmap');
  assert.equal(b.anchor.frames.guideWorldMap.photoUrl, '/worldmap/guide/g-1/photo');
  assert.deepEqual(b.anchor.frames.object, { available: true, url: '/anchors/anc-1/object', calibrated: false });
  assert.equal(b.anchor.configId, 'cfg-1');
});

test('validation lists required and trained steps with verdict URLs for single mode', () => {
  const b = buildGuideBundle(guide, steps, lookups);
  assert.deepEqual(b.validation, [
    { stepId: 's-2', required: true, mode: 'single', trainedAt: now, referenceUrl: '/guides/g-1/steps/s-2/validation-ref.jpg', verdictUrl: '/guides/g-1/steps/s-2/validate' },
    { stepId: 's-3', required: true, mode: 'none' },
  ]);
});

test('an anchor-less guide still bundles with every frame unavailable', () => {
  const b = buildGuideBundle({ ...guide, anchorId: 'nope' }, [], { ...lookups, anchor: () => undefined });
  const errors: string[] = [];
  check(b, schema, '$', errors);
  assert.deepEqual(errors, []);
  assert.equal(b.anchor.frames.qr.available, false);
  assert.equal(b.anchor.frames.worldMap.available, false);
  assert.equal(b.models.length, 1);
});
