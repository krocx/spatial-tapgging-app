// colour.test.ts - greyscale detection, family palette and GLB recolouring (models/colour.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseColours, autoMap, applyColours, familyOf, kindOf, suggestFor, makeGlb, SEAL, FASTENER } from '../src/models/colour.js';
import { readGlbJson } from '../src/models/glb-nodes.js';

const grey = (v: number) => ({ pbrMetallicRoughness: { baseColorFactor: [v, v, v, 1], metallicFactor: 0.3, roughnessFactor: 0.6 } });
const scene = {
  asset: { version: '2.0' },
  materials: [grey(0.6), grey(0.7), grey(0.65)],
  meshes: [{ primitives: [{ material: 0 }] }, { primitives: [{ material: 1 }] }, { primitives: [{ material: 2 }, { material: 0 }] }],
  nodes: [
    { name: 'root', children: [1, 2, 3, 4] },
    { name: 'cmp:HOUSING', mesh: 2 },
    { name: 'cmp:O_RING', mesh: 0 },
    { name: 'cmp:BOLT_M6_01', mesh: 1 },
    { name: 'cmp:BOLT_M6_02', mesh: 1 },          // shares the bolt mesh
    { name: 'cmp:HOUSING#s1f3', mesh: 2 },        // a baked frame: not a part
  ],
  scenes: [{ nodes: [0] }], scene: 0,
};

test('families, kinds and a stable palette', () => {
  assert.equal(familyOf('cmp:BOLT_M6_01'), 'bolt_m6');
  assert.equal(familyOf('cmp:BOLT_M6_02'), 'bolt_m6');
  assert.equal(familyOf('cmp:O_RING.2'), 'o_ring');
  assert.equal(kindOf('bolt_m6'), 'fastener'); assert.equal(kindOf('o_ring'), 'seal'); assert.equal(kindOf('housing'), 'body');
  assert.deepEqual(suggestFor('o_ring'), SEAL); assert.deepEqual(suggestFor('bolt_m6'), FASTENER);
  assert.deepEqual(suggestFor('housing'), suggestFor('housing'), 'same name, same colour');
});

test('a grey model is detected, frames are not parts, shared meshes are cloned before recolouring', () => {
  const glb = makeGlb(scene);
  const a = analyseColours(glb);
  assert.equal(a.greyscale, true); assert.equal(a.textured, false);
  assert.deepEqual(a.parts.map(p => p.name), ['cmp:HOUSING', 'cmp:O_RING', 'cmp:BOLT_M6_01', 'cmp:BOLT_M6_02']);
  assert.equal(a.families.find(f => f.family === 'bolt_m6')?.parts, 2);
  const map = autoMap(a, { housing: [0.1, 0.2, 0.3] });
  const r = applyColours(glb, map);
  assert.equal(r.recoloured, 4);
  assert.equal(r.meshesCloned, 1, 'the second bolt gets its own mesh entry');
  const j = readGlbJson(r.glb) as { nodes: Array<{ name: string; mesh: number }>; meshes: Array<{ primitives: Array<{ material: number }> }>; materials: Array<{ pbrMetallicRoughness: { baseColorFactor: number[] } }> };
  const colourOf = (name: string) => { const n = j.nodes.find(x => x.name === name)!; return j.materials[j.meshes[n.mesh].primitives[0].material].pbrMetallicRoughness.baseColorFactor.slice(0, 3); };
  assert.deepEqual(colourOf('cmp:HOUSING'), [0.1, 0.2, 0.3], 'family override wins');
  assert.deepEqual(colourOf('cmp:O_RING'), SEAL);
  assert.deepEqual(colourOf('cmp:BOLT_M6_01'), FASTENER); assert.deepEqual(colourOf('cmp:BOLT_M6_02'), FASTENER);
  assert.notEqual(j.nodes.find(x => x.name === 'cmp:BOLT_M6_01')!.mesh, j.nodes.find(x => x.name === 'cmp:BOLT_M6_02')!.mesh);
  // Original materials untouched; the frame node still points at the housing's original mesh.
  assert.deepEqual(j.materials[0].pbrMetallicRoughness.baseColorFactor, [0.6, 0.6, 0.6, 1]);
  assert.equal(analyseColours(r.glb).greyscale, false);
});

test('a coloured model is not greyscale', () => {
  const glb = makeGlb({ ...scene, materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.2, 0.1, 1] } }, grey(0.7), { pbrMetallicRoughness: { baseColorFactor: [0.1, 0.4, 0.9, 1] } }] });
  assert.equal(analyseColours(glb).greyscale, false);
});
