// hose.test.ts - Cortona hose sweeps rebuilt as geometry (import/cortona/hose.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHose, invertAffine } from '../src/import/cortona/hose.js';
import { translation, mul, identity } from '../src/import/cortona/scene.js';
import type { VrmlNode } from '../src/import/cortona/vrml.js';

test('invertAffine: M · M⁻¹ = I for a rotation + translation', () => {
  const c = Math.cos(0.7), s = Math.sin(0.7);
  const m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 1.5, -2, 0.25, 1];
  const p = mul(m, invertAffine(m));
  identity().forEach((v, i) => assert.ok(Math.abs(p[i] - v) < 1e-9, `element ${i}`));
});

test('buildHose: a straight three-point hose becomes a closed tube of the right size', () => {
  const objs: VrmlNode[] = [0, 1, 2].map(i => ({ type: 'ObjectVM', def: `cp${i}`, fields: {} }));
  const geom: VrmlNode = { type: 'HoseSplineFlow2', fields: {
    Objects: objs, Points: [0, 0, 0, 0, 0, 0, 0, 0, 0], Tangents: [1, 0, 0, 1, 0, 0, -1, 0, 0],
    WireDiameter: [0.02], PointsPerSegment: [4], cross_quality: [8],
  } };
  const worlds: Record<string, number[]> = { cp0: translation(0, 0, 0), cp1: translation(0.5, 0, 0), cp2: translation(1, 0, 0) };
  const tube = buildHose(geom, identity(), n => ('def' in n && n.def ? worlds[n.def] : null));
  assert.ok(tube, 'built');
  assert.equal(tube!.controlPoints, 3);
  // 2 segments × 4 samples + end = 9 rings of 8, plus two cap centres
  assert.equal(tube!.positions.length / 3, 9 * 8 + 2);
  assert.equal(tube!.indices.length / 3, 8 * 8 * 2 + 2 * 8);
  // Runs along X from 0 to 1, radius 0.01 in Y/Z
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tube!.positions.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], tube!.positions[i + a]); hi[a] = Math.max(hi[a], tube!.positions[i + a]); }
  assert.ok(Math.abs(lo[0]) < 1e-6 && Math.abs(hi[0] - 1) < 1e-6);
  assert.ok(Math.abs(hi[1] - 0.01) < 1e-6 && Math.abs(lo[1] + 0.01) < 1e-6);
  for (const k of tube!.indices) assert.ok(k < tube!.positions.length / 3);
});

test('buildHose: control points are read in the owner frame', () => {
  const objs: VrmlNode[] = [0, 1].map(i => ({ type: 'ObjectVM', def: `q${i}`, fields: {} }));
  const geom: VrmlNode = { type: 'HoseSplineFlow', fields: { Objects: objs, Points: [0, 0, 0, 0, 0, 0], Tangents: [0, 0, 1, 0, 0, -1], PointsPerSegment: [2] } };
  const owner = translation(10, 0, 0);
  const tube = buildHose(geom, owner, n => ('def' in n && n.def === 'q0' ? translation(10, 0, 0) : translation(10, 0, 1)));
  assert.ok(tube);
  const xs: number[] = []; for (let i = 0; i < tube!.positions.length; i += 3) xs.push(tube!.positions[i]);
  assert.ok(Math.max(...xs.map(Math.abs)) < 0.02, 'tube sits at the owner origin, not at world x=10');
  assert.equal(tube!.controlPoints, 2);
});

test('buildHose: fewer than two control points or an unknown point → null', () => {
  const geom: VrmlNode = { type: 'HoseSplineFlow2', fields: { Objects: [{ type: 'ObjectVM', def: 'a', fields: {} }, { type: 'ObjectVM', def: 'b', fields: {} }] } };
  assert.equal(buildHose(geom, identity(), () => null), null);
  const one: VrmlNode = { type: 'HoseSplineFlow2', fields: { Objects: [{ type: 'ObjectVM', def: 'a', fields: {} }] } };
  assert.equal(buildHose(one, identity(), () => identity()), null);
});
