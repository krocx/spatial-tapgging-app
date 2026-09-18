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
  assert.equal(s.routes.length, 8);
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

test('importer: steps per SubStep, node deltas from commands, text from interactivity, callouts, parts', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm());
  const g = r.imported;
  assert.equal(g.name, 'Sample assembly');
  assert.equal(g.steps.length, 3);
  assert.equal(g.steps[0].title, '1. Prepare — Remove cover');
  assert.equal(g.steps[0].text, 'Lift the cover straight up and set aside.');
  assert.equal(g.steps[0].durationSec, 2);
  // step 1: SwitchOFF → hidden; transparency 0.7 → ghost 0.3; viewpoint
  const n1 = Object.fromEntries(g.steps[0].nodes!.map(n => [n.node, n]));
  assert.equal(n1['cmp:PN_0190-10001_1'].show, 'hidden');
  assert.equal(n1['cmp:PN_0190-10001_1'].sourceKey, '-106464992');
  assert.equal(n1['cmp:PN_0190-10002_1'].show, 'ghost');
  assert.equal(n1['cmp:PN_0190-10002_1'].opacity, 0.3);
  assert.deepEqual(g.steps[0].view?.position, [0.5, 0.3, 1.2]);
  // step 2: translation ends at rest → insert; callout text appended; SwitchOFF 0 → solid
  const n2 = Object.fromEntries(g.steps[1].nodes!.map(n => [n.node, n]));
  assert.equal(n2['cmp:PN_0190-10001_1'].animate, 'insert');
  assert.deepEqual(n2['cmp:PN_0190-10001_1'].from, [0.1, 0.3, 0]);
  assert.deepEqual(n2['cmp:PN_0190-10001_1'].to, [0.1, 0.06, 0]);
  assert.equal(n2['cmp:PN_0190-10001_1'].show, 'solid');
  assert.ok(g.steps[1].text.includes('Align the ring notch') && g.steps[1].text.includes('Two-person lift.') && g.steps[1].text.includes('Torque to spec'));
  assert.ok(!('cmp:CALLOUT_A' in n2), 'widgets are not part nodes');
  // step 3: rotation + colour + html panel text
  const n3 = Object.fromEntries(g.steps[2].nodes!.map(n => [n.node, n]));
  assert.equal(n3['cmp:PN_0190-10002_1'].animate, 'move');
  assert.deepEqual(n3['cmp:PN_0190-10002_1'].rotationTo, [0, 0, 1, 1.5708]);
  assert.deepEqual(n3['cmp:PN_0190-10002_1'].color, [1, 0.2, 0.1]);
  assert.ok(g.steps[2].text.includes('Check & verify') && g.steps[2].text.includes('seal seating'));
  // log is content-free and complete
  const L = r.log;
  assert.equal(L.procedure.steps, 2); assert.equal(L.procedure.substeps, 3);
  assert.equal(L.procedure.commands.SwitchOFF, 4);
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
