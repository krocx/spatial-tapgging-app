// importer.ts - published Cortona3D RapidManual .htm → ImportedGuide + assembly GLB.
//
// Pipeline (docs/ar-ojt/CORTONA3D-IMPORT.md, Stage 2):
//   .htm ─▶ solo+zip bundle ─▶ VRML97 (PROTOs kept) ─▶ scene graph ─▶ GLB
//                          └▶ interactivity.xml / rwi ─▶ text, part numbers
//   Procedure → Step → SubStep → commands ─▶ per-SubStep nodes[] deltas
//   interactivity <Procedure>/<Item> ─▶ one guide step per work Item, merging
//   the deltas of the SubSteps (Actions) it plays; SubStep fallback when a
//   publication carries no Procedure tree. Steps with simulate FALSE are
//   scene set-up and are never shown.
//
// The import log is CONTENT-FREE by construction: counts, PROTO type names,
// publish option names, warnings - never step text, part numbers or ids.

import type { ImportedGuide, ImportedGuideStep, GuideStepNode, GuideStepView } from '@spatial/shared';
import { readCortonaBundle, type CortonaBundle } from './bundle.js';
import { parseVrml, numField, walkNodes } from './vrml.js';
import { buildScene, axisAngle, mul, type SceneGraph } from './scene.js';
import { writeGlb, type NodeExtras } from './glb.js';
import { extractProcedure, classifyMotion, type ExtractedProcedure, type ExtractedSubStep } from './procedure.js';
import { collectWidgets } from './widgets.js';
import { readInteractivity, readRwi, type InteractivityIndex, type RwiIndex } from './interactivity.js';

export interface CortonaImportOptions {
  /** Refuse the import when the scene instantiates PROTO types we do not recognise. */
  strict?: boolean;
  /** Override the guide name (defaults to the procedure title or the bundle scene name). */
  name?: string;
}

export interface CortonaImportLog {
  source:      { kind: 'htm' | 'zip'; bytes: number };
  bundle:      { entries: number; inventory: { kind: string; bytes: number }[]; hasInteractivity: boolean; hasRwi: boolean; svgs: number };
  vrml:        { header: string; protosDeclared: number; routes: number };
  protos:      { handled: string[]; ignored: string[]; unknown: string[]; counts: Record<string, number> };
  scene:       { nodes: number; defs: number; meshes: number; triangles: number; extentM?: [number, number, number] };
  procedure:   { steps: number; substeps: number; setupSubsteps: number; workItems: number; unreferencedSubsteps: number; stepSource: 'workItems' | 'substeps';
                 commands: Record<string, number>; unresolvedRoutes: number; withView: number; withCallouts: number };
  text:        { stepsWithTitle: number; stepsWithText: number; fromInteractivity: number };
  parts:       { docItems: number; rwiBomRows: number; nodesWithObjectId: number; nodesWithPartNumber: number };
  publish:     Record<string, string>;
  /** Up-axis correction derived from the deck's cameras (see frameCorrection). */
  frame:       { corrected: boolean; cameraUpY: number; cameras: number; axis?: [number, number, number]; angleDeg?: number };
  warnings:    string[];
  strict:      boolean;
}

export interface CortonaImportResult {
  imported:  ImportedGuide;
  glb:       Buffer;
  log:       CortonaImportLog;
  /** State before step 1 (the simulate FALSE set-up step's deltas, merged). */
  initialNodes: GuideStepNode[];
  /** Geometry bounds in the assembly frame. */
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  /** Per-node metadata (DEF → objectID/part number) for callers that build tags. */
  extras:    Map<string, NodeExtras>;
}

const PUBLISH_KEYS = ['GLTF', 'X3D', 'UpRight', 'SingleHTMLBundle', 'VRMLProfile', 'CoordinateResolution', 'EnablePMI', 'KeepSurfaceEdges'];

export function importCortonaBundle(input: Buffer, opts: CortonaImportOptions = {}): CortonaImportResult {
  const warnings: string[] = [];
  const bundle: CortonaBundle = readCortonaBundle(input);
  const kind: 'htm' | 'zip' = input.length >= 4 && input.readUInt32LE(0) === 0x04034b50 ? 'zip' : 'htm';

  const vrml  = parseVrml(bundle.vrmlText);
  bundle.vrmlText = Buffer.alloc(0);   // the scene is parsed - let the 100+ MB of text go
  const frame = frameCorrection(vrml);
  if (frame.corrected) warnings.push(`cameras look at the model upside-down (mean camera-up Y = ${frame.cameraUpY.toFixed(2)}) - assembly rotated ${frame.angleDeg}° so up is +Y`);
  const scene = buildScene(vrml, { frame: frame.matrix });
  const widgets = collectWidgets(vrml);
  const widgetText = new Map<string, string | undefined>();
  for (const [def, w] of widgets) widgetText.set(def, w.text);

  const proc = extractProcedure(vrml, widgetText, scene.materialOwners);
  if (proc.protos.unknown.length) {
    const msg = `unrecognised PROTO types instantiated: ${proc.protos.unknown.join(', ')}`;
    if (opts.strict) throw new Error(`cortona: ${msg}`);
    warnings.push(msg);
  }
  if (!proc.substeps.length) warnings.push('no Procedure/Step/SubStep tree found - guide will have no steps');
  const hoses = Object.entries(proc.protos.counts).filter(([k]) => /^(HoseSplineFlow|VMHose|CableFlat|VMRope)\d*$/.test(k)).reduce((a, [, n]) => a + n, 0);
  if (hoses) warnings.push(`${hoses} procedural hose/cable/rope object(s) are not rendered in the assembly model`);

  // rest poses for insert/remove classification
  const rest = new Map<string, number[]>();
  for (const [def, sn] of scene.byDef) rest.set(def, numField(sn.vrml, 'translation', [0, 0, 0]));
  classifyMotion(proc, rest);

  const inter: InteractivityIndex | null = bundle.interactivity ? safe(() => readInteractivity(bundle.interactivity!), warnings, 'interactivity.xml') : null;
  const rwi:   RwiIndex | null           = bundle.rwi ? safe(() => readRwi(bundle.rwi!), warnings, 'rwi') : null;

  // node extras: objectID from commands, part info from DocItems
  // DocItem/@id IS the part's DEF in every publication seen (the objectID
  // handles are runtime-only and may not line up across files), so join by
  // DEF first and fall back to the objectID learned from the commands.
  const extras = new Map<string, NodeExtras>();
  let nodesWithPart = 0;
  for (const def of scene.byDef.keys()) {
    const oid = proc.objectIdByDef.get(def);
    const p = inter?.partByDocId.get(def) ?? (oid !== undefined ? inter?.partByObjectID.get(oid) : undefined);
    if (oid === undefined && !p) continue;
    const e: NodeExtras = {};
    if (oid !== undefined) e.objectID = oid; else if (p?.objectID !== undefined) e.objectID = p.objectID;
    if (p) { if (p.partNumber) { e.partNumber = p.partNumber; nodesWithPart++; } if (p.description) e.description = p.description; }
    extras.set(def, e);
  }

  // steps - one per work Item (document step) when the interactivity file has a
  // Procedure tree; otherwise one per animation SubStep.
  let fromInter = 0, withTitle = 0, withText = 0, withView = 0, withCallouts = 0, unreferenced = 0;
  const shown = proc.substeps.filter(ss => !ss.setup);
  const setupSubsteps = proc.substeps.length - shown.length;
  const bySubId = new Map<string, ExtractedSubStep>();
  for (const ss of shown) if (ss.id) bySubId.set(ss.id, ss);
  const workItems = inter?.workItems ?? [];
  const stepSource: 'workItems' | 'substeps' = workItems.length ? 'workItems' : 'substeps';
  const steps: ImportedGuideStep[] = [];
  const assemblyCentre: [number, number, number] | undefined = scene.bbox
    ? [0, 1, 2].map(a => round5((scene.bbox!.min[a] + scene.bbox!.max[a]) / 2)) as [number, number, number] : undefined;
  let lastCad: [number, number, number] | undefined;
  // Initial state = parts the scene starts with hidden (Switch/whichChoice -1)
  // + the set-up step's deltas (parts moved to their exploded positions).
  const initialNodes: GuideStepNode[] = [];
  for (const [def, sn] of scene.byDef) if (!sn.visible && sn.meshes.length + sn.children.length > 0) initialNodes.push({ node: `cmp:${def}`, show: 'hidden' });
  for (const n of mergeSubsteps(proc.substeps.filter(ss => ss.setup)).nodes) initialNodes.push(pruneNode(n));

  const finish = (title: string, text: string, subs: ExtractedSubStep[]): ImportedGuideStep => {
    const m = mergeSubsteps(subs);
    const parts = [text, ...m.callouts].map(x => x.trim()).filter(Boolean);
    const dedup = parts.filter((x, k) => parts.indexOf(x) === k);
    const body = dedup.join('\n\n') || title;
    if (dedup.length) withText++; if (m.view) withView++; if (m.callouts.length) withCallouts++;
    const step: ImportedGuideStep = { sequenceNumber: steps.length + 1, title, text: body, completionRequired: true };
    if (m.nodes.length) step.nodes = m.nodes.map(n => { const p = pruneNode(n); const l = labelFor(n.node.replace(/^cmp:/, ''), scene, extras); return l ? { ...p, label: l } : p; });
    // Pin = centroid of the parts the step is ABOUT: moving parts first, then
    // highlighted, then revealed-solid, then anything it touches (a "ghost the
    // whole assembly" step must not pin to the centre of the machine).
    const tiers = [
      m.nodes.filter(n => n.animate),
      m.nodes.filter(n => n.color),
      m.nodes.filter(n => n.show === 'solid'),
      m.nodes,
    ];
    let cad: [number, number, number] | undefined;
    for (const t of tiers) { cad = centroidOf(t.map(n => n.node.replace(/^cmp:/, '')), scene.boundsByDef); if (cad) break; }
    cad = cad ?? lastCad ?? assemblyCentre;
    if (cad) { step.cadPosition = cad; lastCad = cad; }
    if (m.view) step.view = frame.corrected ? rotateView(m.view, frame.matrix!) : m.view;
    if (m.durationSec) step.durationSec = m.durationSec;
    steps.push(step);
    return step;
  };

  if (stepSource === 'workItems') {
    const referenced = new Set<string>();
    for (const wi of workItems) {
      const subs = wi.actionIds.map(id => bySubId.get(id)).filter((x): x is ExtractedSubStep => !!x);
      for (const ss of subs) referenced.add(ss.id!);
      // Section title: the document's top-level Item, unless that is a bare number
      // (RWI numbers its steps) - then the Simulation Step's own title.
      const simStep = subs[0]?.stepId ? inter?.textById.get(subs[0].stepId)?.title : undefined;
      const candidates = [wi.path[0], simStep, subs[0]?.stepTitle].filter((x): x is string => !!x);
      const top = candidates.find(x => !/^[\d.\s]+$/.test(x));
      // Text: the Item's own Text/Comment, else the first Action/SubStep's, else the Step's.
      let leaf = wi.title; let text = wi.text ?? wi.comment ?? (subs[0] ? subStepText(subs[0], inter) : '');
      // No Description but the Text opens with a short heading line (DITA/RWI <h3>) - promote it.
      if ((!leaf || /^[\d.\s]+$/.test(leaf)) && text.includes('\n')) {
        const [first, ...rest] = text.split('\n'); const restText = rest.join('\n').trim();
        if (first.length <= 80 && restText) { leaf = leaf && !/^[\d.\s]+$/.test(leaf) ? leaf : first.trim(); text = restText; }
      }
      const title = (top ? [`${wi.topIndex}. ${top}`, leaf && leaf !== top ? leaf : undefined] : [leaf ? `${wi.topIndex}. ${leaf}` : undefined]).filter(Boolean).join(' - ') || `Step ${wi.topIndex}`;
      if (top || leaf) withTitle++; fromInter++;
      finish(title, text, subs);
    }
    // animation sub-steps the document never references: keep them, after the document steps, so nothing is lost
    for (const ss of shown) if (ss.id && !referenced.has(ss.id)) { unreferenced++; finish(subStepTitle(ss, inter), subStepText(ss, inter), [ss]); }
  } else {
    for (const ss of shown) {
      const it = ss.id ? inter?.textById.get(ss.id) : undefined; if (it) fromInter++;
      if (it?.title || ss.title || ss.stepTitle) withTitle++;
      finish(subStepTitle(ss, inter), subStepText(ss, inter), [ss]);
    }
  }

  const procTitle = (proc.id && inter?.textById.get(proc.id)?.title) || proc.title;
  const name = (opts.name ?? procTitle ?? rwi?.jobTitle ?? bundle.vrmlName.replace(/\.wrl$/i, '')).trim() || 'Imported procedure';
  const imported: ImportedGuide = { name, description: proc.comment?.trim() || undefined, steps };

  const glb = writeGlb(scene, extras);

  const publish: Record<string, string> = {};
  for (const k of PUBLISH_KEYS) if (inter?.publishOptions[k] !== undefined) publish[k] = inter.publishOptions[k];
  if (publish.UpRight && publish.UpRight !== 'No') warnings.push(`publish option UpRight=${publish.UpRight}: axis convention may differ from Y-up`);

  const log: CortonaImportLog = {
    source: { kind, bytes: input.length },
    bundle: { entries: bundle.inventory.length, inventory: bundle.inventory.map(e => ({ kind: e.kind, bytes: e.bytes })), hasInteractivity: !!bundle.interactivity, hasRwi: !!bundle.rwi, svgs: Object.keys(bundle.svgs).length },
    vrml:   { header: vrml.header, protosDeclared: vrml.protos.size, routes: vrml.routes.length },
    protos: proc.protos,
    scene:  { nodes: countNodes(scene.roots), defs: scene.byDef.size, meshes: scene.meshCount, triangles: scene.triangleCount,
              extentM: scene.bbox ? [0, 1, 2].map(a => round(scene.bbox!.max[a] - scene.bbox!.min[a])) as [number, number, number] : undefined },
    procedure: { steps: proc.stepCount, substeps: proc.substeps.length, setupSubsteps, workItems: workItems.length, unreferencedSubsteps: unreferenced, stepSource,
                 commands: proc.commandCounts, unresolvedRoutes: proc.unresolvedRoutes, withView, withCallouts },
    text:   { stepsWithTitle: withTitle, stepsWithText: withText, fromInteractivity: fromInter },
    parts:  { docItems: inter?.partByObjectID.size ?? 0, rwiBomRows: rwi?.bom.length ?? 0, nodesWithObjectId: proc.objectIdByDef.size, nodesWithPartNumber: nodesWithPart },
    publish, warnings, strict: !!opts.strict,
    frame: { corrected: frame.corrected, cameraUpY: round(frame.cameraUpY), cameras: frame.cameras, ...(frame.axis && { axis: frame.axis, angleDeg: frame.angleDeg }) },
  };
  if (scene.bbox) {
    const ext = log.scene.extentM!; const maxExt = Math.max(...ext);
    if (maxExt > 50) warnings.push(`scene extent ${maxExt.toFixed(1)} m - units may be millimetres, not metres`);
    if (maxExt < 0.01) warnings.push(`scene extent ${maxExt} m - model is tiny; check units`);
  }
  if (rwi && rwi.stepCount === 0 && rwi.taskCount > 0) { /* expected: rwi is not a step source */ }

  const bounds = scene.bbox ? { min: scene.bbox.min.map(round5) as [number, number, number], max: scene.bbox.max.map(round5) as [number, number, number] } : undefined;
  return { imported, glb, log, extras, initialNodes, bounds };
}

/**
 * Up-axis correction. Some decks are authored in a frame where the model is
 * upside-down and every stored camera carries the compensating rotation
 * (their `orientation` is ~π about X); the source viewer looks right only
 * through those cameras. We never read the cameras for placement, so such a
 * deck imports tilted. Detect it from the cameras themselves: rotate the
 * camera's up vector (0,1,0) by each Viewpoint / Set_Viewpoint orientation
 * and average. Up pointing down (mean Y < -0.5) ⇒ rotate the whole assembly
 * by the minimal rotation taking that mean up-vector onto +Y. Decks whose
 * cameras look from above/below (mean Y near 0, as in an overhead deck) are
 * left alone, and so is every deck whose cameras agree with +Y.
 */
function frameCorrection(vrml: ReturnType<typeof parseVrml>): { corrected: boolean; cameraUpY: number; cameras: number; matrix?: number[]; axis?: [number, number, number]; angleDeg?: number } {
  const ups: number[][] = [];
  walkNodes(vrml.nodes, n => {
    if (!/^(Viewpoint|Set_Viewpoint)/.test(n.type)) return;
    const o = numField(n, 'orientation', []); if (o.length !== 4) return;
    const m = axisAngle(o); ups.push([m[4], m[5], m[6]]);   // column 1 = rotated (0,1,0)
  });
  if (!ups.length) return { corrected: false, cameraUpY: 1, cameras: 0 };
  const u = [0, 1, 2].map(a => ups.reduce((s, v) => s + v[a], 0) / ups.length);
  const len = Math.hypot(u[0], u[1], u[2]) || 1; const un = u.map(x => x / len);
  if (un[1] > -0.5) return { corrected: false, cameraUpY: un[1], cameras: ups.length };
  // minimal rotation un → +Y: axis = un × Y, angle = acos(un·Y); for un ≈ -Y use X.
  let ax = [un[2], 0, -un[0]]; let al = Math.hypot(ax[0], ax[1], ax[2]);
  if (al < 1e-6) { ax = [1, 0, 0]; al = 1; }
  const axis: [number, number, number] = [ax[0] / al, ax[1] / al, ax[2] / al];
  const angle = Math.acos(Math.max(-1, Math.min(1, un[1])));
  return { corrected: true, cameraUpY: un[1], cameras: ups.length, matrix: axisAngle([...axis, angle]), axis: axis.map(round) as [number, number, number], angleDeg: Math.round(angle * 180 / Math.PI) };
}

/** Carry a step's suggested camera into the corrected assembly frame. */
function rotateView(v: GuideStepView, m: number[]): GuideStepView {
  const rot = (p: [number, number, number]): [number, number, number] => [
    round5(m[0] * p[0] + m[4] * p[1] + m[8]  * p[2]),
    round5(m[1] * p[0] + m[5] * p[1] + m[9]  * p[2]),
    round5(m[2] * p[0] + m[6] * p[1] + m[10] * p[2]),
  ];
  const out: GuideStepView = { ...v };
  if (v.position) out.position = rot(v.position);
  if (v.center) out.center = rot(v.center);
  if (v.orientation) {
    // R · axisAngle(orientation) → back to axis-angle
    const r = mul(m, axisAngle(v.orientation));
    const angle = Math.acos(Math.max(-1, Math.min(1, (r[0] + r[5] + r[10] - 1) / 2)));
    const s = 2 * Math.sin(angle);
    out.orientation = s < 1e-6 ? [0, 0, 1, 0] : [round5((r[6] - r[9]) / s), round5((r[8] - r[2]) / s), round5((r[1] - r[4]) / s), round5(angle)];
  }
  return out;
}

function subStepTitle(ss: ExtractedSubStep, inter: InteractivityIndex | null): string {
  const it = ss.id ? inter?.textById.get(ss.id) : undefined;
  const stepIt = ss.stepId ? inter?.textById.get(ss.stepId) : undefined;
  const subTitle = it?.title ?? ss.title; const stepTitle = stepIt?.title ?? ss.stepTitle;
  return [stepTitle && `${ss.stepIndex}. ${stepTitle}`, subTitle && subTitle !== stepTitle ? subTitle : undefined]
    .filter(Boolean).join(' - ') || `Step ${ss.stepIndex}.${ss.subIndex}`;
}
function subStepText(ss: ExtractedSubStep, inter: InteractivityIndex | null): string {
  const it = ss.id ? inter?.textById.get(ss.id) : undefined;
  const stepIt = ss.stepId ? inter?.textById.get(ss.stepId) : undefined;
  return it?.text ?? it?.comment ?? ss.comment ?? stepIt?.text ?? stepIt?.comment ?? ss.stepComment ?? '';
}

/** Lay several animation sub-steps out as ONE timeline: each sub-step's
 *  deltas keep their own timing, offset by the sub-steps before it. A node may
 *  therefore appear several times in a step (fade in → flash → attach); the
 *  cumulative state engine applies them in order, the runtime plays them at
 *  their offsets - exactly what the source viewer does. */
function mergeSubsteps(subs: ExtractedSubStep[]): { nodes: GuideStepNode[]; view?: GuideStepView; callouts: string[]; durationSec?: number } {
  const nodes: GuideStepNode[] = [];
  let view: GuideStepView | undefined; const callouts: string[] = []; let offset = 0;
  for (const ss of subs) {
    const subDur = ss.durationSec ?? 1;
    for (const n of ss.nodes) {
      const g: GuideStepNode = { ...n };
      g.delaySec = round5((n.delaySec ?? 0) + offset);
      if (n.durationSec === undefined) g.durationSec = round5(subDur);
      nodes.push(g);
    }
    if (ss.view) view = ss.view;
    for (const c of ss.callouts) if (!callouts.includes(c)) callouts.push(c);
    offset += subDur;
  }
  // Chronological (stable): the cumulative state engine applies in array order.
  const ordered = nodes.map((n, i) => ({ n, i })).sort((a, b) => ((a.n.delaySec ?? 0) - (b.n.delaySec ?? 0)) || (a.i - b.i)).map(x => x.n);
  return { nodes: ordered, view, callouts, durationSec: offset ? round5(offset) : undefined };
}

/** Centre of the union of the named nodes' bounds (assembly frame), if any are known. */
function centroidOf(defs: string[], bounds: Map<string, { min: number[]; max: number[] }>): [number, number, number] | undefined {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let n = 0;
  for (const d of defs) {
    const b = bounds.get(d); if (!b) continue; n++;
    for (let a = 0; a < 3; a++) { if (b.min[a] < min[a]) min[a] = b.min[a]; if (b.max[a] > max[a]) max[a] = b.max[a]; }
  }
  if (!n) return undefined;
  return [0, 1, 2].map(a => round5((min[a] + max[a]) / 2)) as [number, number, number];
}
const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;

/** Friendly name for a part: source object name → BOM description → part number → nothing. */
function labelFor(def: string, scene: SceneGraph, extras: Map<string, NodeExtras>): string | undefined {
  const sn = scene.byDef.get(def);
  const name = sn?.name?.trim();
  if (name) return name;
  const e = extras.get(def);
  return e?.description?.trim() || e?.partNumber?.trim() || undefined;
}

function pruneNode(n: GuideStepNode): GuideStepNode {
  const o: GuideStepNode = { node: n.node };
  for (const k of ['show', 'opacity', 'animate', 'from', 'to', 'rotationFrom', 'rotationTo', 'color', 'durationSec', 'delaySec', 'effect', 'sourceKey'] as const) {
    const v = n[k]; if (v !== undefined) (o as unknown as Record<string, unknown>)[k] = v;
  }
  return o;
}
function countNodes(roots: { children: unknown[] }[]): number {
  let c = 0; const st = [...roots] as { children: { children: unknown[] }[] }[];
  while (st.length) { const n = st.pop()!; c++; st.push(...(n.children as typeof st)); }
  return c;
}
function safe<T>(fn: () => T, warnings: string[], what: string): T | null {
  try { return fn(); } catch (e) { warnings.push(`${what}: ${(e as Error).message}`); return null; }
}
const round = (x: number): number => Math.round(x * 1000) / 1000;

export type { ExtractedProcedure };
