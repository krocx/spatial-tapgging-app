// cortona-import.test.ts — Cortona3D RapidManual importer against the synthetic bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtm, buildBundleZip, buildVrml } from './cortona-fixture.js';

test('vrml: parses PROTO declarations, instances, DEF/USE and ROUTEs', async () => {
  const { parseVrml } = await import('../src/import/cortona/vrml.js');
  const s = parseVrml(buildVrml());
  assert.ok(s.protos.has('Procedure') && s.protos.has('Set_translation') && s.protos.has('IndexedFaceSetWithEdges'));
  assert.equal(s.protos.get('IndexedFaceSetWithEdges')!.external?.length, 1);
  assert.ok(s.defs.has('PN_0190-10001_1') && s.defs.has('SS_ss-2') && s.defs.has('C4'));
  assert.equal(s.routes.length, 9);
  const r = s.routes.find(r => r.fromNode === 'C4')!;
  assert.deepEqual(r, { fromNode: 'C4', fromField: 'value_changed', toNode: 'PN_0190-10001_1', toField: 'translation' });
  const proto = s.protos.get('SubStep')!;
  assert.equal(proto.fields.find(f => f.name === 'duration')!.type, 'SFTime');
});

test('bundle: extracts solo+zip from .htm, sniffs kinds, gunzips the scene', async () => {
  const { readCortonaBundle } = await import('../src/import/cortona/bundle.js');
  const b = readCortonaBundle(buildHtm({ withSvg: true }));
  assert.ok(b.vrmlText.startsWith('#VRML V2.0 utf8'));
  assert.ok(b.interactivity && b.rwi);
  assert.equal(Object.keys(b.svgs).length, 1);
  assert.deepEqual(b.inventory.map(e => e.kind).sort(), ['svg', 'vrml', 'xml', 'xml']);
  // also accepts the raw ZIP
  assert.equal(readCortonaBundle(buildBundleZip()).vrmlName, 'Sample.wrl');
});

test('importer: one step per document work Item, merged sub-step deltas, set-up step dropped, callouts, parts', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm());
  const g = r.imported;
  assert.equal(g.name, 'Sample assembly');
  assert.equal(g.steps.length, 2, 'set-up step (simulate FALSE) is not a guide step');
  assert.equal(g.steps[0].title, '1. Prepare — Remove cover');
  assert.equal(g.steps[0].text, 'Lift the cover straight up and set aside.');
  assert.equal(g.steps[0].durationSec, 2);
  // Deltas are a TIMELINE: several per node, chronological, with delaySec.
  const of = (step: typeof g.steps[number], node: string) => step.nodes!.filter(n => n.node === node);
  // work item 1 = sub-step ss-1: SwitchOFF → hidden; transparency 0.7 → ghost 0.3; viewpoint
  assert.equal(of(g.steps[0], 'cmp:PN_0190-10001_1').at(-1)!.show, 'hidden');
  assert.equal(of(g.steps[0], 'cmp:PN_0190-10001_1')[0].sourceKey, '-106464992');
  assert.equal(of(g.steps[0], 'cmp:PN_0190-10002_1').at(-1)!.show, 'ghost');
  assert.equal(of(g.steps[0], 'cmp:PN_0190-10002_1').at(-1)!.opacity, 0.3);
  assert.deepEqual(g.steps[0].view?.position, [0.5, 0.3, 1.2]);
  // work item 2 lays ss-2 + ss-3 out in sequence: insert (ends at rest) + solid on part 1;
  // rotation + colour on part 2; ss-3 deltas start after ss-2's 4 s; durations add.
  assert.equal(g.steps[1].title, '2. Install ring — Lower the ring and lock it');
  assert.equal(g.steps[1].durationSec, 7);
  const p1 = of(g.steps[1], 'cmp:PN_0190-10001_1'), p2 = of(g.steps[1], 'cmp:PN_0190-10002_1');
  const mv = p1.find(n => n.animate)!;
  assert.equal(mv.animate, 'insert');
  assert.deepEqual(mv.from, [0.1, 0.3, 0]);
  assert.deepEqual(mv.to, [0.1, 0.06, 0]);
  assert.equal(mv.delaySec, 0); assert.equal(mv.durationSec, 2);     // period [0,0.5] of a 4 s sub-step → 0–2 s
  assert.equal(p1.at(-1)!.show, 'solid');
  const rot = p2.find(n => n.animate)!;
  assert.equal(rot.animate, 'move');
  assert.deepEqual(rot.rotationTo, [0, 0, 1, 1.5708]);
  assert.ok(rot.delaySec! >= 4, 'ss-3 deltas start after ss-2 (4 s)');
  assert.deepEqual(p2.find(n => n.color)!.color, [1, 0.2, 0.1]);
  const order = g.steps[1].nodes!.map(n => n.delaySec ?? 0);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'chronological');
  assert.ok(g.steps[1].text.startsWith('Align the ring notch with the base key.\nRotate 90° clockwise'));
  assert.ok(g.steps[1].text.includes('Torque to spec') && g.steps[1].text.includes('Check & verify') && g.steps[1].text.includes('seal seating'));
  assert.ok(!g.steps[1].text.includes('<p>'), 'html stripped');
  assert.ok(!g.steps[1].nodes!.some(n => n.node === 'cmp:CALLOUT_A'), 'widgets are not part nodes');
  // log is content-free and complete
  const L = r.log;
  assert.equal(L.procedure.steps, 3); assert.equal(L.procedure.substeps, 4); assert.equal(L.procedure.setupSubsteps, 1);
  assert.equal(L.procedure.workItems, 2); assert.equal(L.procedure.stepSource, 'workItems'); assert.equal(L.procedure.unreferencedSubsteps, 0);
  assert.equal(L.procedure.commands.SwitchOFF, 5);
  assert.equal(L.procedure.unresolvedRoutes, 0);
  assert.equal(L.parts.docItems, 2); assert.equal(L.parts.nodesWithPartNumber, 2); assert.equal(L.parts.rwiBomRows, 2);
  assert.equal(L.publish.GLTF, 'No');
  assert.deepEqual(L.protos.unknown, []);
  assert.ok(L.protos.ignored.includes('CalloutM6') && L.protos.handled.includes('SubStep'));
  assert.ok(!JSON.stringify(L).includes('Torque') && !JSON.stringify(L).includes('0190-10001'));
  // extras carry part numbers for the GLB
  assert.equal(r.extras.get('PN_0190-10001_1')?.partNumber, '0190-10001');
});

test('glb: valid header, named nodes, hierarchy, materials', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const { glb, log } = importCortonaBundle(buildHtm({ parts: 3 }));
  assert.equal(glb.readUInt32LE(0), 0x46546C67);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  assert.equal(json.asset.version, '2.0');
  const names = json.nodes.map((n: { name: string }) => n.name);
  assert.ok(names.includes('cmp:ASSEMBLY_ROOT') && names.includes('cmp:PN_0190-10001_1') && names.includes('cmp:BASE_PLATE'));
  const root = json.nodes.find((n: { name: string }) => n.name === 'cmp:ASSEMBLY_ROOT');
  assert.ok(root.children.length >= 4);
  const p1 = json.nodes.find((n: { name: string }) => n.name === 'cmp:PN_0190-10001_1');
  assert.equal(p1.extras.partNumber, '0190-10001');
  assert.equal(p1.extras.objectID, -106464992);
  assert.ok(Math.abs(p1.matrix[12] - 0.1) < 1e-6, 'translation lands in matrix');
  assert.equal(json.meshes.length, 1, 'identical geometry is shared (content-addressed meshes)');
  assert.equal(log.scene.meshes, 1); assert.equal(log.scene.triangles, 12);
  assert.ok(json.accessors[0].min.length === 3);
  // hidden widgets are not geometry nodes; callout PROTO instances skipped
  assert.ok(!names.some((n: string) => n.includes('CALLOUT')));
});

test('strict mode refuses unknown PROTOs; lenient mode warns', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  assert.throws(() => importCortonaBundle(buildHtm({ unknownProto: true }), { strict: true }), /MysteryWidget/);
  const r = importCortonaBundle(buildHtm({ unknownProto: true }));
  assert.deepEqual(r.log.protos.unknown, ['MysteryWidget']);
  assert.ok(r.log.warnings.some(w => w.includes('MysteryWidget')));
});

test('widgets: rtf and html to plain text', async () => {
  const { rtfToText, htmlToText } = await import('../src/import/cortona/widgets.js');
  // RTF: the single space after a control word is a delimiter, not text (so "\\b bold\\b0  world" needs two spaces).
  assert.equal(rtfToText('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\b bold\\b0  world\\par second\\line line \\u8364? x}'), 'Hello bold world\nsecond\nline € x');
  assert.equal(htmlToText('<p>A &amp; B</p><p>C</p>'), 'A & B\nC');
});

test('vrml: IS-bound eventIn/eventOut inside Script nodes (seen in real publications)', async () => {
  const { parseVrml } = await import('../src/import/cortona/vrml.js');
  const src = `#VRML V2.0 utf8
PROTO W [ field SFNode p NULL eventIn SFBool _rebuild_ eventOut SFBool _geom_changed_ ] {
  Group { children [ DEF S Script { url "javascript: function f(){}"
    field SFNode parent IS p
    eventIn SFBool rebuild IS _rebuild_
    eventOut SFBool _geom_changed_ IS _geom_changed_
    eventIn SFVec3f allPosition
    field SFBool pos_changed FALSE } ] } }
DEF X W { }`;
  const s = parseVrml(src);
  assert.ok(s.protos.has('W') && s.defs.has('X'));
});

test('scene: a top-level USE and IS-bound children do not crash the scene build (small publications)', async () => {
  const { parseVrml, walkNodes } = await import('../src/import/cortona/vrml.js');
  const { buildScene } = await import('../src/import/cortona/scene.js');
  const src = `#VRML V2.0 utf8
DEF PART_A Transform { translation 1 2 3 children [ Shape { appearance Appearance { material Material { diffuseColor 1 0 0 } }
  geometry IndexedFaceSet { coord Coordinate { point [ 0 0 0, 1 0 0, 0 1 0 ] } coordIndex [ 0 1 2 -1 ] } } ] }
USE PART_A
Group { children [ USE PART_A, NULL ] }`;
  const s = parseVrml(src);
  let count = 0; walkNodes(s.nodes, () => { count++; });
  assert.ok(count >= 3);
  const g = buildScene(s);                                  // used to throw: Cannot read properties of undefined (reading 'translation')
  assert.equal(g.roots.length, 3);
  assert.ok(g.byDef.has('PART_A'));
  assert.equal(g.meshCount, 1);                              // same geometry content, deduped
});

test('primitives: parametric geometry PROTOs produce closed meshes', async () => {
  const { buildPrimitive } = await import('../src/import/cortona/primitives.js');
  const f = (vals: Record<string, number[]>) => (name: string, fb: number[]) => vals[name] ?? fb;
  const box = buildPrimitive('BOX', f({ scale: [0.2, 0.1, 0.05] }))!;
  assert.equal(box.positions.length, 24); assert.equal(box.indices.length, 36);
  assert.equal(Math.max(...box.positions.filter((_, i) => i % 3 === 0)), 0.1);
  const cyl = buildPrimitive('CYLNDR', f({ D: [0.1], H: [0.3], quality: [16] }))!;
  assert.equal(Math.max(...cyl.positions.filter((_, i) => i % 3 === 1)), 0.3);
  for (const t of ['SPHERE', 'TORUS', 'WASHER']) {
    const m = buildPrimitive(t, f({}))!;
    assert.ok(m.indices.length % 3 === 0 && m.indices.every(i => i < m.positions.length / 3), t);
  }
  assert.equal(buildPrimitive('BOXDUMMY', f({})), null);
});

test('scene: leaf Shape with an empty Material inherits the colour from its ObjectVM appearance', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const { glb } = importCortonaBundle(buildHtm({ parts: 2, colourOnObjectVM: true }));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const reds = json.materials.filter((m: { pbrMetallicRoughness: { baseColorFactor: number[] } }) => Math.abs(m.pbrMetallicRoughness.baseColorFactor[0] - 0.9) < 1e-3);
  assert.ok(reds.length >= 1, 'ObjectVM colour reached the leaf mesh');
});

test('importer: cameras that look at the model upside-down rotate the assembly so up is +Y', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const ok = importCortonaBundle(buildHtm({ parts: 2 }));
  assert.equal(ok.log.frame.corrected, false);
  const flipped = importCortonaBundle(buildHtm({ parts: 2, upsideDown: true }));
  assert.equal(flipped.log.frame.corrected, true);
  assert.ok(flipped.log.frame.angleDeg! >= 170, `angle ${flipped.log.frame.angleDeg}`);
  assert.ok(flipped.log.warnings.some(w => /upside-down/.test(w)));
  const json = JSON.parse(flipped.glb.subarray(20, 20 + flipped.glb.readUInt32LE(12)).toString('utf8'));
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.equal(root.name, '__frame'); assert.ok(root.matrix && root.matrix[5] < -0.98, 'Y flipped by the frame node');
  // parts under the frame keep their own local translation
  const p1 = json.nodes.find((n: { name: string }) => n.name === 'cmp:PN_0190-10001_1');
  assert.ok(Math.abs(p1.matrix[12] - 0.1) < 1e-6);
  // the assembly's bounds (used for pins) are in the corrected frame: parts sit at +y 0.06 → now negative
  assert.ok(flipped.bounds!.max[1] <= 0.001, `bounds max y ${flipped.bounds!.max[1]}`);
  // a step view is carried into the corrected frame: camera up ends near +Y
  const v = flipped.imported.steps.find(s => s.view)?.view!;
  assert.ok(v && v.orientation, 'view kept');
});

test('vrml: DEF names with spaces (Cortona part descriptions) parse, and USE / ROUTE resolve them', async () => {
  const { parseVrml } = await import('../src/import/cortona/vrml.js');
  const src = `#VRML V2.0 utf8
DEF Callout_P/N_-_0022-22449_HOUSING LIFT_e0c Transform { translation 1 2 3 children [ DEF Plain Shape { } ] }
DEF Timer TimeSensor { }
Group { children [ USE Callout_P/N_-_0022-22449_HOUSING LIFT_e0c USE Plain ] }
ROUTE Timer.fraction_changed TO Callout_P/N_-_0022-22449_HOUSING LIFT_e0c.set_translation
ROUTE Callout_P/N_-_0022-22449_HOUSING LIFT_e0c.translation_changed TO Timer.startTime
`;
  const s = parseVrml(src);
  const name = 'Callout_P/N_-_0022-22449_HOUSING LIFT_e0c';
  assert.ok(s.defs.has(name), [...s.defs.keys()].join(' | '));
  assert.equal(s.defs.get(name)!.type, 'Transform');
  const grp = s.nodes.find(n => 'type' in n && n.type === 'Group') as unknown as { fields: { children: unknown[] } };
  assert.deepEqual(grp.fields.children, [{ use: name }, { use: 'Plain' }]);
  assert.deepEqual(s.routes[0], { fromNode: 'Timer', fromField: 'fraction_changed', toNode: name, toField: 'set_translation' });
  assert.deepEqual(s.routes[1], { fromNode: name, fromField: 'translation_changed', toNode: 'Timer', toField: 'startTime' });
});
