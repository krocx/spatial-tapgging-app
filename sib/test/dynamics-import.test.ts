/** Dynamics 365 Guides `.guide` importer (AROMS-364 / 365): layers and the nine scenarios, on synthetic packages only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTar, parseEntryName, decodeEtag, safeEntryName, TarError } from '../src/import/dynamics/tar.js';
import { orderByPrevious } from '../src/import/dynamics/body.js';
import { sniff, normalizeQuat, convertPosition, convertRotation, quatToAxisAngle } from '../src/import/dynamics/assets.js';
import { mergeGlbs, parseGlb } from '../src/import/dynamics/glb-merge.js';
import { styleToNode, labelOf, OBJECT_STYLE, RESPONSE_ACTION, ANCHOR_TYPE } from '../src/import/dynamics/enums.js';
import { buildGuidePackage, writeTar, tinyGlb, tinyPng, tinyJpeg } from '../src/import/dynamics/fixture.js';
import { importGuidePackage, reportText } from '../src/import/dynamics/importer.js';

// ── Layers ──────────────────────────────────────────────────────────────────

test('tar: reads flat entries, refuses paths, links, devices and oversize', () => {
  const t = writeTar([{ name: 'Guide_Body', bytes: Buffer.from('{}') }, { name: 'Metadata_x', bytes: Buffer.alloc(1000, 1) }]);
  const es = readTar(t);
  assert.deepEqual(es.map(e => e.name), ['Guide_Body', 'Metadata_x']); assert.equal(es[1].bytes.length, 1000);
  assert.throws(() => readTar(writeTar([{ name: '../evil', bytes: Buffer.from('x') }])), TarError);
  assert.throws(() => readTar(writeTar([{ name: '/abs', bytes: Buffer.from('x') }])), TarError);
  assert.throws(() => readTar(writeTar([{ name: 'a/b', bytes: Buffer.from('x') }])), TarError);
  assert.throws(() => readTar(writeTar([{ name: 'link', bytes: Buffer.alloc(0), type: '2', linkname: '/etc/passwd' }])), TarError);
  assert.throws(() => readTar(writeTar([{ name: 'dev', bytes: Buffer.alloc(0), type: '3' }])), TarError);
  assert.throws(() => readTar(writeTar([{ name: 'big', bytes: Buffer.alloc(2000) }]), { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 10000 }), TarError);
  assert.throws(() => readTar(writeTar(Array.from({ length: 5 }, (_, i) => ({ name: `e${i}`, bytes: Buffer.alloc(1) }))), { maxEntries: 3, maxEntryBytes: 10, maxTotalBytes: 100 }), TarError);
  assert.throws(() => readTar(Buffer.from('not a tar at all, far too short')), TarError);
  // a corrupted checksum
  const bad = writeTar([{ name: 'Guide_Body', bytes: Buffer.from('{}') }]); bad[0] ^= 0xff;
  assert.throws(() => readTar(bad), TarError);
  assert.equal(safeEntryName('Model_Body_x'), true); assert.equal(safeEntryName('a\u0001b'), false);
});

test('entry names: kind, part, guid, etag', () => {
  const g = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const m = parseEntryName(`Model_Body_${g}_W%2F%2212345%22`);
  assert.equal(m.kind, 'Model'); assert.equal(m.part, 'Body'); assert.equal(m.guid, g); assert.equal(decodeEtag(m.etag), 'W/"12345"');
  assert.equal(parseEntryName(`Image_SmallThumbnail_${g}_W%2F%221%22`).part, 'SmallThumbnail');
  assert.equal(parseEntryName(`Metadata_${g}`).kind, 'Metadata');
  assert.equal(parseEntryName('Guide_Body').kind, 'Guide_Body');
  assert.equal(parseEntryName(`Hologram_Body_${g}_x`).kind, 'Unknown');
  assert.equal(parseEntryName('garbage').kind, 'Unknown');
});

test('ordering: linked list from shuffled arrays, cycles, dangling, multiple heads', () => {
  const items = [{ id: 'c', prev: 'b' }, { id: 'a', prev: null }, { id: 'b', prev: 'a' }];
  assert.deepEqual(orderByPrevious(items, i => i.prev, 'step').items.map(i => i.id), ['a', 'b', 'c']);
  const cyc = orderByPrevious([{ id: 'x', prev: 'y' }, { id: 'y', prev: 'x' }], i => i.prev, 'step');
  assert.equal(cyc.items.length, 2); assert.ok(cyc.warnings.some(w => w.includes('cycle')));
  const dang = orderByPrevious([{ id: 'a', prev: 'ghost' }, { id: 'b', prev: 'a' }], i => i.prev, 'task');
  assert.deepEqual(dang.items.map(i => i.id), ['a', 'b']); assert.ok(dang.warnings.some(w => w.includes('not in the package')));
  const heads = orderByPrevious([{ id: 'a', prev: null }, { id: 'b', prev: null }], i => i.prev, 'task');
  assert.equal(heads.items.length, 2); assert.ok(heads.warnings.some(w => w.includes('heads')));
});

test('enums: raw values first, labels as fallback, never a crash', () => {
  assert.deepEqual(styleToNode(OBJECT_STYLE.XRay, 'X-ray'), { show: 'ghost', known: true });
  assert.equal(styleToNode(OBJECT_STYLE.Green, undefined).color?.[1], 0.8);
  assert.equal(styleToNode(937380099, 'Red highlight').color?.[0], 0.9);
  assert.equal(styleToNode(937380099, 'See-through X-Ray').show, 'ghost');
  assert.equal(styleToNode(937380099, undefined).show, 'solid');
  assert.equal(labelOf(RESPONSE_ACTION.GoToStep, undefined, RESPONSE_ACTION), 'GoToStep');
  assert.equal(labelOf(937380044, 'Teleport', RESPONSE_ACTION), 'Teleport');
  assert.equal(labelOf(null, undefined, ANCHOR_TYPE), 'unset');
});

test('coordinates: Unity left-handed → right-handed, behind the flag', () => {
  assert.deepEqual(convertPosition([1, 2, 3]), [1, 2, -3]);
  assert.deepEqual(convertRotation([0.1, 0.2, 0.3, 0.9]), [-0.1, -0.2, 0.3, 0.9]);
  assert.deepEqual(convertPosition([1, 2, 3], { flipZ: false }), [1, 2, 3]);
  const aa = quatToAxisAngle([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  assert.ok(Math.abs(aa[3] - Math.PI / 2) < 1e-6 && Math.abs(aa[1] - 1) < 1e-6);
  assert.deepEqual(quatToAxisAngle([0, 0, 0, 1]), [0, 1, 0, 0]);
});

test('sniff: bytes, not Format', () => {
  assert.equal(sniff(tinyGlb()), 'glb'); assert.equal(sniff(tinyPng()), 'png'); assert.equal(sniff(tinyJpeg()), 'jpeg');
  assert.equal(sniff(Buffer.from('{"asset":{}}')), 'gltf'); assert.equal(sniff(Buffer.from('nope')), 'unknown');
});

test('glb merge: instances share meshes, nodes are named, spec/gloss folded, default material added, animations re-targeted', () => {
  const glbs = new Map([['a', tinyGlb('specgloss', 'A')], ['b', tinyGlb('nomaterial', 'B')], ['c', tinyGlb('animated', 'C')]]);
  const r = mergeGlbs(glbs, [
    { name: 'pl:1', assetKey: 'a', translation: [1, 0, 0] }, { name: 'pl:2', assetKey: 'a', translation: [2, 0, 0], scale: [2, 2, 2] },
    { name: 'pl:3', assetKey: 'b' }, { name: 'pl:4', assetKey: 'c', rotation: [0, 0, 0, 1] }, { name: 'pl:5', assetKey: 'missing' },
  ]);
  const j = parseGlb(r.glb).json;
  assert.equal(r.stats.assets, 3); assert.equal(r.stats.instances, 4); assert.equal(r.stats.meshes, 3);
  assert.equal(r.stats.specGlossFolded, 1); assert.equal(r.stats.defaultMaterials, 1); assert.equal(r.stats.animations, 1);
  assert.ok(r.stats.warnings.some(w => w.includes('missing')));
  const names = j.nodes.map((n: { name: string }) => n.name);
  for (const n of ['pl:1', 'pl:2', 'pl:3', 'pl:4']) assert.ok(names.includes(n), n);
  assert.ok(!JSON.stringify(j).includes('pbrSpecularGlossiness'));
  const folded = j.materials.find((m: { name: string }) => m.name === 'sg'); assert.ok(Math.abs(folded.pbrMetallicRoughness.roughnessFactor - 0.1) < 1e-6);
  // the animation targets the instanced node, not the source index
  const anim = j.animations[0]; const target = j.nodes[anim.channels[0].target.node]; assert.ok(target.name.startsWith('pl:4/'));
  assert.ok(r.bounds && r.bounds.max[0] > 2 && r.bounds.min[0] <= 0);
  // every bufferView lies inside the single buffer
  const total = j.buffers[0].byteLength; for (const bv of j.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= total);
});

// ── Scenarios ───────────────────────────────────────────────────────────────

const minimal = () => buildGuidePackage({ name: 'Minimal', tasks: [{ steps: [{ text: 'Do the thing' }] }], completion: { text: 'Done' } });

test('1 · minimal guide: one task, one step, completion', () => {
  const r = importGuidePackage(minimal().tar);
  assert.equal(r.imported.name, 'Minimal'); assert.equal(r.report.tasks, 1); assert.equal(r.imported.steps.length, 2);
  assert.equal(r.imported.steps[0].section, 'Task A'); assert.equal(r.imported.steps[1].title, 'Complete'); assert.equal(r.imported.steps[1].evidenceRequired, true);
  assert.equal(r.glb, null); assert.equal(r.report.warnings.length, 0, r.report.warnings.join('; '));
  assert.ok(reportText(r.report).includes('1 task(s), 2 step(s)'));
});

test('2 · several tasks and steps, shuffled: order comes only from the previous-links', () => {
  const fx = buildGuidePackage({ shuffle: true, seed: 7, tasks: [
    { name: 'Prep', steps: [{ id: 'p1', text: 'P1' }, { id: 'p2', text: 'P2' }, { id: 'p3', text: 'P3' }] },
    { name: 'Work', steps: [{ id: 'w1', text: 'W1' }, { id: 'w2', text: 'W2' }] },
    { name: 'Close', steps: [{ id: 'c1', text: 'C1' }] },
  ] });
  const r = importGuidePackage(fx.tar);
  assert.deepEqual(r.imported.steps.map(s => s.text), ['P1', 'P2', 'P3', 'W1', 'W2', 'C1']);
  assert.deepEqual(r.imported.steps.map(s => s.section), ['Prep', 'Prep', 'Prep', 'Work', 'Work', 'Close']);
  assert.equal(r.report.warnings.length, 0, r.report.warnings.join('; '));
});

test('3 · question step with three responses: next, go-to-step across tasks, no action', () => {
  const fx = buildGuidePackage({ tasks: [
    { name: 'A', steps: [{ id: 'a1', text: 'Check', type: 'question', responses: [{ text: 'Yes', action: RESPONSE_ACTION.GoToNextStep }, { text: 'No', action: RESPONSE_ACTION.GoToStep, step: 'b2' }, { text: 'Skip', action: RESPONSE_ACTION.NoAction }] }, { id: 'a2', text: 'A2' }] },
    { name: 'B', steps: [{ id: 'b1', text: 'B1' }, { id: 'b2', text: 'Fix it' }] },
  ] });
  const r = importGuidePackage(fx.tar);
  const q = r.imported.steps[0];
  assert.equal(q.nextOnSuccessSeq, undefined);            // next step is the default
  assert.equal(q.nextOnFailureSeq, 4);                     // b2 is the 4th step
  assert.ok(q.text.includes('1. Yes') && q.text.includes('2. No') && q.text.includes('3. Skip'));
  assert.equal(r.report.branching.goToStep, 1); assert.equal(r.report.branching.crossTask, 1); assert.equal(r.report.branching.noAction, 1); assert.equal(r.report.branching.foldedToLinear, 0);
  assert.equal(r.report.steps.question, 1);
});

test('4 · many objects: same asset several times with styles, isplaced=false, object without placement, Invisible', () => {
  const fx = buildGuidePackage({
    models: { bolt: { name: 'Bolt' }, inv: { name: 'Invisible' } },
    tasks: [{ steps: [{ text: 'Place', objects: [
      { model: 'bolt', placements: [{ model: 'bolt', position: [0, 0, 1], style: OBJECT_STYLE.Original }, { model: 'bolt', position: [0.1, 0, 1], style: OBJECT_STYLE.XRay }, { model: 'bolt', position: [0.2, 0, 1], style: OBJECT_STYLE.Green }, { model: 'bolt', position: [9, 9, 9], isPlaced: false }, { model: 'bolt', position: [0.3, 0, 1], style: 'unknown', styleLabel: 'Blue highlight' }] },
      { model: 'bolt' },
      { model: 'inv', placements: [{ model: 'inv', position: [0, 0, 0] }] },
    ] }] }],
  });
  const r = importGuidePackage(fx.tar);
  const s = r.imported.steps[0];
  assert.ok(r.glb && parseGlb(r.glb).json.nodes.length > 5);
  assert.equal(r.report.objects.unplaced, 1); assert.equal(r.report.objects.withoutPlacement, 1); assert.equal(r.report.objects.invisible, 1); assert.equal(r.report.objects.stock, 1);
  assert.equal(s.nodes?.length, 5);
  assert.equal(s.nodes?.filter(n => n.show === 'ghost').length, 1);
  assert.equal(s.nodes?.filter(n => n.color).length, 2);                    // Green + "Blue highlight" by label
  assert.equal(s.nodes?.filter(n => n.show === 'hidden').length, 1);        // Invisible
  assert.equal(r.report.enums.unknownValues, 1); assert.equal(r.report.enums.labelsUsed, 1);
  assert.ok(s.cadPosition && Math.abs(s.cadPosition[2] + 0.8) < 1e-6);      // centroid of the 5 shown, z flipped
  assert.equal(r.report.merge?.instances, 5);
  assert.equal(r.initialNodes.length, 5); assert.ok(r.initialNodes.every(n => n.show === 'hidden'));
});

test('5 · step image and video, attention director at a placement', () => {
  const fx = buildGuidePackage({
    models: { arrow: { name: 'Arrow' } }, images: { pic: {}, jpg: { kind: 'jpeg' } }, videos: ['clip'],
    tasks: [{ steps: [
      { text: 'Look', image: 'pic', video: 'clip', objects: [{ model: 'arrow', placements: [{ id: 'pa', model: 'arrow', position: [1, 1, 1] }] }], attention: { placement: 'pa' } },
      { text: 'Then', image: 'jpg', attention: { position: [0, 0, 2] } },
    ] }],
  });
  const r = importGuidePackage(fx.tar);
  assert.equal(r.stepImages.size, 2); assert.equal(r.stepImages.get(1)?.sniffed, 'png'); assert.equal(r.stepImages.get(2)?.sniffed, 'jpeg');
  assert.equal(r.media.length, 1); assert.equal(r.media[0].kind, 'video');
  assert.deepEqual(r.imported.steps[0].cadPosition, [1, 1, -1]);               // the director's placement, converted
  assert.deepEqual(r.imported.steps[1].cadPosition, [0, 0, -2]);
  assert.ok(r.imported.steps[0].nodes?.some(n => n.effect === 'flash'));
  assert.equal(r.report.steps.withAttention, 2); assert.equal(r.report.media.videosAsLinks, 1);
  // step 2 hides step 1's arrow
  assert.ok(r.imported.steps[1].nodes?.some(n => n.show === 'hidden' && n.node.startsWith('pl:')));
});

test('6 · completion step with completion objects and placements', () => {
  const fx = buildGuidePackage({ models: { check: { name: 'Check' } }, tasks: [{ steps: [{ text: 'Do' }] }], completion: { text: 'All done', objects: [{ model: 'check', placements: [{ model: 'check', position: [0, 1, 0] }] }], attention: { position: [0, 1, 0] } } });
  const r = importGuidePackage(fx.tar);
  const last = r.imported.steps[r.imported.steps.length - 1];
  assert.equal(last.section, 'Completion'); assert.equal(last.text, 'All done'); assert.equal(last.nodes?.length, 1); assert.deepEqual(last.cadPosition, [0, 1, 0]);
  assert.equal(r.report.objects.completionPlacements, 1); assert.equal(r.report.steps.completion, 1);
});

test('7 · anchor types: holographic (verified), an unknown value, with an anchor object', () => {
  const h = importGuidePackage(buildGuidePackage({ tasks: [{ steps: [{ text: 'x' }] }] }).tar);
  assert.equal(h.report.anchor.known, true); assert.equal(h.report.anchor.label, 'Holographic');
  const u = importGuidePackage(buildGuidePackage({ anchorType: 'unknown', anchorTypeLabel: 'QR Code', tasks: [{ steps: [{ text: 'x' }] }] }).tar);
  assert.equal(u.report.anchor.known, false); assert.equal(u.report.anchor.label, 'QR Code'); assert.ok(u.report.enums.unknownValues >= 1);
  const o = importGuidePackage(buildGuidePackage({ models: { m: {} }, anchorObject: 'm', tasks: [{ steps: [{ text: 'x' }] }] }).tar);
  assert.equal(o.report.anchor.hasObject, true); assert.ok(o.report.unmapped.some(x => x.includes('anchor 3D object')));
});

test('8 · corrupt and edge cases: missing arrays, unknown option sets, dangling link, cycle, missing body, unreferenced asset, format mismatch, unknown kind', () => {
  const fx = buildGuidePackage({
    models: { gone: { omitBody: true }, lie: { formatSays: 'Gltf' }, spare: {} , bad: { variant: 'corrupt' } },
    tasks: [{ steps: [
      { id: 'a', text: 'A', type: 'unknown', objects: [{ model: 'gone', placements: [{ model: 'gone' }] }, { model: 'lie', placements: [{ model: 'lie' }] }, { model: 'bad', placements: [{ model: 'bad' }] }] },
      { id: 'b', text: 'B', previous: 'dangling', type: 'question', responses: [{ action: 'unknown' }] },
      { id: 'c', text: 'C', previous: 'd', type: 'question', responses: [{ action: RESPONSE_ACTION.GoToStep, step: 'nowhere-00000000-0000-0000-0000-000000000000' }] },
      { id: 'd', text: 'D', previous: 'c' },
    ] }],
    dropArrays: ['msmrw_msmrw_guide_msmrw_guidecompletionstepobject_Guide'], unknownEntry: true, extraRootKeys: 2,
  });
  const r = importGuidePackage(fx.tar);
  assert.equal(r.imported.steps.length, 4);
  assert.ok(r.report.missingKeys.includes('msmrw_msmrw_guide_msmrw_guidecompletionstepobject_Guide'));
  assert.equal(r.report.unknownRootKeys, 2); assert.equal(r.report.assets.unknownKind, 1);
  assert.equal(r.report.assets.referencedMissing, 1); assert.equal(r.report.assets.unreferenced, 1); assert.equal(r.report.assets.formatMismatch, 1);
  assert.ok(r.report.warnings.some(w => w.includes('cycle'))); assert.ok(r.report.warnings.some(w => w.includes('not in the package')));
  assert.ok(r.report.warnings.some(w => w.includes('unknown step template'))); assert.ok(r.report.warnings.some(w => w.includes('not a GLB') || w.includes('corrupt') || w.includes('GLB')));
  assert.ok(r.report.branching.unresolved === 1);
  assert.ok(r.report.enums.unknownValues >= 2);
});

test('9 · malicious tars are rejected safely', () => {
  for (const bad of [
    writeTar([{ name: '../../etc/passwd', bytes: Buffer.from('x') }]),
    writeTar([{ name: '/Guide_Body', bytes: Buffer.from('{}') }]),
    writeTar([{ name: 'Guide_Body', bytes: Buffer.alloc(0), type: '2', linkname: '/x' }]),
    writeTar([{ name: 'Guide_Body', bytes: Buffer.alloc(0), type: '1', linkname: 'x' }]),
  ]) assert.throws(() => importGuidePackage(bad), TarError);
  assert.throws(() => importGuidePackage(writeTar([{ name: 'Guide_Body', bytes: Buffer.alloc(5000) }]), { limits: { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 10000 } }), TarError);
  assert.throws(() => importGuidePackage(writeTar([{ name: 'Guide_Manifest', bytes: Buffer.from('{}') }])), /no Guide_Body/);
  assert.throws(() => importGuidePackage(writeTar([{ name: 'Guide_Body', bytes: Buffer.from('not json') }])), /not valid JSON/);
});

test('zero placement rotations are repaired to identity in the GLB and counted (iOS drew nothing)', () => {
  assert.deepEqual(normalizeQuat([0, 0, 0, 0]), { q: [0, 0, 0, 1], repaired: true });
  assert.deepEqual(normalizeQuat([NaN, 0, 0, 1]), { q: [0, 0, 0, 1], repaired: true });
  assert.deepEqual(normalizeQuat([0, 0, 0, 2]), { q: [0, 0, 0, 1], repaired: false });
  assert.deepEqual(quatToAxisAngle([0, 0, 0, 0]), [0, 1, 0, 0]);
  const fx = buildGuidePackage({ models: { m: {} }, tasks: [{ steps: [{ text: 'x', objects: [{ model: 'm', placements: [
    { model: 'm', position: [0, 0, 1], rotation: [0, 0, 0, 0] }, { model: 'm', position: [1, 0, 0], rotation: [0, 0, 0, 0] }, { model: 'm', position: [0, 1, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
  ] }] }] }] });
  const r = importGuidePackage(fx.tar);
  assert.equal(r.report.objects.rotationRepaired, 2);
  assert.ok(r.report.warnings.some(w => w.includes('(0,0,0,0) rotation')));
  const nodes = parseGlb(r.glb!).json.nodes.filter((n: { name: string }) => /^pl:[^/]+$/.test(n.name));
  assert.equal(nodes.length, 3);
  for (const n of nodes) { const q = n.rotation ?? [0, 0, 0, 1]; assert.ok(Math.abs(Math.hypot(...(q as number[])) - 1) < 1e-6, `unit quaternion on ${n.name}`); }
});

test('animated placements carry a clip flag (no keyframe-less motion); a QR-anchored guide gets an estimated pose', () => {
  const fx = buildGuidePackage({ anchorType: 'unknown', anchorTypeLabel: 'QR Code', models: { arrow: { variant: 'animated' }, still: {} }, tasks: [{ steps: [{ text: 'x', objects: [
    { model: 'arrow', placements: [{ model: 'arrow', animated: true }] }, { model: 'still', placements: [{ model: 'still' }] },
  ] }] }] });
  const r = importGuidePackage(fx.tar);
  const nodes = r.imported.steps[0].nodes ?? [];
  const anim = nodes.find(n => n.clip), still = nodes.find(n => !n.clip && n.show === 'solid');
  assert.ok(anim && still);
  assert.deepEqual(anim!.clip, { play: true, loop: true }); assert.equal(anim!.animate, undefined);
  assert.equal(r.report.objects.animated, 1);
  assert.equal(r.anchorPose?.source, 'import'); assert.deepEqual(r.anchorPose?.rotation, [0, 0, 0, 1]); assert.equal(r.report.anchor.poseEstimated, true);
  // a holographic anchor offers no estimate
  const h = importGuidePackage(buildGuidePackage({ models: { m: {} }, tasks: [{ steps: [{ text: 'x', objects: [{ model: 'm', placements: [{ model: 'm' }] }] }] }] }).tar);
  assert.equal(h.anchorPose, undefined); assert.equal(h.report.anchor.poseEstimated, false);
});

test('steps that place nothing inherit the nearest positioned step\'s spot, so one Place Assembly places the whole guide', () => {
  const fx = buildGuidePackage({ models: { m: {} }, tasks: [{ steps: [
    { text: 'Read this first' }, { text: 'Question?', type: 'question' },
    { text: 'Fit', objects: [{ model: 'm', placements: [{ model: 'm', position: [1, 0, 0] }] }] },
    { text: 'Then', objects: [{ model: 'm', placements: [{ model: 'm', position: [0, 0, 2] }] }] },
    { text: 'Sign off' },
  ] }] });
  const r = importGuidePackage(fx.tar);
  const pos = r.imported.steps.map(s => s.cadPosition);
  assert.deepEqual(pos[0], pos[2]); assert.deepEqual(pos[1], pos[2]);     // next positioned step
  assert.deepEqual(pos[4], pos[3]);                                        // previous when nothing follows
  assert.equal(r.report.steps.positionInherited, 3);
  assert.ok(reportText(r.report).includes('3 step(s) without objects positioned'));
  // a text-only guide (no GLB) gets no positions at all
  const t = importGuidePackage(buildGuidePackage({ tasks: [{ steps: [{ text: 'a' }, { text: 'b' }] }] }).tar);
  assert.ok(t.imported.steps.every(s => !s.cadPosition)); assert.equal(t.report.steps.positionInherited, 0);
});

test('golden: the report shape is stable and content-free', () => {
  const fx = buildGuidePackage({ name: 'Secret procedure X', models: { m: { name: 'Proprietary part 42' } }, tasks: [{ name: 'Confidential task', steps: [{ text: 'Torque the secret bolt to 12 Nm', objects: [{ model: 'm', placements: [{ model: 'm' }] }] }] }] });
  const r = importGuidePackage(fx.tar);
  const txt = reportText(r.report, 'guide');
  for (const leak of ['Secret', 'Proprietary', 'Confidential', 'secret bolt']) assert.ok(!txt.includes(leak), leak);
  assert.deepEqual(Object.keys(r.report).sort(), ['anchor', 'assets', 'branching', 'enums', 'folder', 'manifest', 'media', 'merge', 'missingKeys', 'objects', 'source', 'steps', 'styles', 'tasks', 'unknownRootKeys', 'unmapped', 'warnings'].sort());
  assert.equal(r.imported.steps[0].text, 'Torque the secret bolt to 12 Nm');   // the content goes to the guide, not the log
  assert.equal(r.provenance.guideId, fx.ids.guide); assert.equal(r.provenance.assets.length, 1);
});
