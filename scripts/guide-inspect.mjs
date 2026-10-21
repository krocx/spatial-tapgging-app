#!/usr/bin/env node
/**
 * guide-inspect.mjs - dry-run a Dynamics 365 Guides `.guide` package through
 * the SIB importer and print the report. Writes NOTHING: no guide, no model,
 * no files - unless --out is given, which writes the merged GLB and the
 * reconstructed step tree beside each other for a look in a viewer.
 *
 *   npm run guide:inspect -- <file.guide> [--json] [--tree] [--keep-frame] [--out <dir>]
 *
 *   --json        print the report as JSON instead of text
 *   --tree        also print the reconstructed step tree (sections, steps,
 *                 branches, node counts) - titles and text are NOT printed
 *   --keep-frame  no Unity → right-handed conversion (diagnosis)
 *   --out <dir>   write <dir>/assembly.glb and <dir>/tree.json
 *
 * Needs the compiled server: `npm run build --workspace=@spatial/sib`.
 * The report is content-free (counts and GUIDs); the tree names steps by
 * sequence number only. Real guides may contain proprietary procedures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const importerPath = path.join(repo, 'sib/dist/import/dynamics/importer.js');
if (!fs.existsSync(importerPath)) {
  console.error('sib/dist not found - run `npm run build --workspace=@spatial/sib` first.');
  process.exit(2);
}
const { importGuidePackage, reportText } = await import(pathToFileURL(importerPath).href);

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const opt = (n) => { const i = args.indexOf(n); if (i >= 0) { const v = args[i + 1]; args.splice(i, 2); return v; } return undefined; };
const asJson = flag('--json'), tree = flag('--tree'), keepFrame = flag('--keep-frame');
const out = opt('--out');
const sample = opt('--make-sample');
if (sample) {
  // A synthetic package from the test fixture builder - two tasks, a
  // question branch, three placed objects, one step image. Nothing real.
  const { buildGuidePackage } = await import(pathToFileURL(path.join(repo, 'sib/dist/import/dynamics/fixture.js')).href);
  const fx = buildGuidePackage({ name: 'Sample pump rebuild (synthetic)', models: { bolt: { name: 'Bolt' }, arrow: { name: 'Arrow', variant: 'animated' } }, images: { pic: {} }, tasks: [
    { name: 'Prepare', steps: [{ text: 'Isolate the pump and tag it out.', image: 'pic' }, { text: 'Is the pressure gauge at zero?', type: 'question', responses: [{ text: 'Yes', action: 937380001 }, { text: 'No', action: 937380002, step: 'vent' }] }] },
    { name: 'Rebuild', steps: [
      { id: 'vent', text: 'Vent the line at the bleed valve.', objects: [{ model: 'arrow', placements: [{ id: 'pa', model: 'arrow', position: [0.2, 0.1, 0.4] }] }], attention: { placement: 'pa' } },
      { text: 'Fit the four bolts hand-tight.', objects: [{ model: 'bolt', placements: [{ model: 'bolt', position: [0, 0, 0.5] }, { model: 'bolt', position: [0.1, 0, 0.5], style: 937380009 }, { model: 'bolt', position: [0, 0.1, 0.5], style: 937380007 }] }] },
    ] },
  ], completion: { text: 'Pump rebuilt - sign off.' } });
  fs.writeFileSync(sample, fx.tar);
  console.log(`written: ${sample} (${fx.tar.length} bytes, synthetic)`);
  if (!args[0]) process.exit(0);
}
const file = args[0];
if (!file) { console.error('usage: npm run guide:inspect -- <file.guide> [--json] [--tree] [--keep-frame] [--out <dir>]\n       npm run guide:inspect -- --make-sample <out.guide>'); process.exit(2); }

const bytes = fs.readFileSync(file);
let r;
try { r = importGuidePackage(bytes, { frame: { flipZ: !keepFrame } }); }
catch (e) { console.error(`refused: ${e.message}`); process.exit(1); }

const label = path.basename(file);
if (asJson) console.log(JSON.stringify({ file: label, bytes: bytes.length, report: r.report, provenance: r.provenance }, null, 2));
else console.log(reportText(r.report, label));

const treeOf = () => ({
  guideId: r.provenance.guideId,
  assembly: r.glb ? { bytes: r.glb.length, bounds: r.bounds, initialNodes: r.initialNodes.length } : null,
  steps: r.imported.steps.map(s => ({
    seq: s.sequenceNumber, section: s.section, textChars: (s.text ?? '').length,
    image: r.stepImages.has(s.sequenceNumber), evidence: !!s.evidenceRequired,
    onSuccess: s.nextOnSuccessSeq, onFailure: s.nextOnFailureSeq,
    cadPosition: s.cadPosition, nodes: (s.nodes ?? []).map(n => `${n.node.slice(0, 11)} ${n.show ?? ''}${n.effect ? ' ' + n.effect : ''}${n.color ? ' colour' : ''}`.trim()),
  })),
});
if (tree) {
  console.log('');
  for (const s of treeOf().steps) {
    const br = [s.onSuccess ? `✓→${s.onSuccess}` : '', s.onFailure ? `✗→${s.onFailure}` : ''].filter(Boolean).join(' ');
    console.log(`${String(s.seq).padStart(3)}  ${(s.section ?? '').slice(0, 24).padEnd(24)}  ${String(s.textChars).padStart(4)} chars  ${s.image ? 'img ' : '    '}${s.evidence ? 'evid ' : '     '}${s.nodes.length ? s.nodes.length + ' node(s) ' : ''}${s.cadPosition ? '@' + s.cadPosition.map(v => v.toFixed(2)).join(',') + ' ' : ''}${br}`);
  }
}
if (out) {
  fs.mkdirSync(out, { recursive: true });
  if (r.glb) fs.writeFileSync(path.join(out, 'assembly.glb'), r.glb);
  fs.writeFileSync(path.join(out, 'tree.json'), JSON.stringify(treeOf(), null, 2));
  console.log(`\nwritten: ${out}/${r.glb ? 'assembly.glb, ' : ''}tree.json`);
}
