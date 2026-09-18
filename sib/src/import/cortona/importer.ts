// importer.ts — published Cortona3D RapidManual .htm → ImportedGuide + assembly GLB.
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
// publish option names, warnings — never step text, part numbers or ids.

import type { ImportedGuide, ImportedGuideStep, GuideStepNode, GuideStepView } from '@spatial/shared';
import { readCortonaBundle, type CortonaBundle } from './bundle.js';
import { parseVrml, numField } from './vrml.js';
import { buildScene } from './scene.js';
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
  const scene = buildScene(vrml);
  const widgets = collectWidgets(vrml);
  const widgetText = new Map<string, string | undefined>();
  for (const [def, w] of widgets) widgetText.set(def, w.text);

  const proc = extractProcedure(vrml, widgetText);
  if (proc.protos.unknown.length) {
    const msg = `unrecognised PROTO types instantiated: ${proc.protos.unknown.join(', ')}`;
    if (opts.strict) throw new Error(`cortona: ${msg}`);
    warnings.push(msg);
  }
  if (!proc.substeps.length) warnings.push('no Procedure/Step/SubStep tree found — guide will have no steps');
  const hoses = Object.entries(proc.protos.counts).filter(([k]) => /^(HoseSplineFlow|VMHose|CableFlat|VMRope)\d*$/.test(k)).reduce((a, [, n]) => a + n, 0);
  if (hoses) warnings.push(`${hoses} procedural hose/cable/rope object(s) are not rendered in the assembly model`);

  // rest poses for insert/remove classification
  const rest = new Map<string, number[]>();
  for (const [def, sn] of scene.byDef) rest.set(def, numField(sn.vrml, 'translation', [0, 0, 0]));
  classifyMotion(proc, rest);

  const inter: InteractivityIndex | null = bundle.interactivity ? safe(() => readInteractivity(bundle.interactivity!), warnings, 'interactivity.xml') : null;
  const rwi:   RwiIndex | null           = bundle.rwi ? safe(() => readRwi(bundle.rwi!), warnings, 'rwi') : null;

  // node extras: objectID from commands, part info from DocItems
  const extras = new Map<string, NodeExtras>();
  let nodesWithPart = 0;
  for (const [def, oid] of proc.objectIdByDef) {
    const e: NodeExtras = { objectID: oid };
    const p = inter?.partByObjectID.get(oid);
    if (p) { if (p.partNumber) { e.partNumber = p.partNumber; nodesWithPart++; } if (p.description) e.description = p.description; }
    extras.set(def, e);
  }

  // steps — one per work Item (document step) when the interactivity file has a
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
  const initialNodes = mergeSubsteps(proc.substeps.filter(ss => ss.setup)).nodes.map(pruneNode);

  const finish = (title: string, text: string, subs: ExtractedSubStep[]): ImportedGuideStep => {
    const m = mergeSubsteps(subs);
    const parts = [text, ...m.callouts].map(x => x.trim()).filter(Boolean);
    const dedup = parts.filter((x, k) => parts.indexOf(x) === k);
    const body = dedup.join('\n\n') || title;
    if (dedup.length) withText++; if (m.view) withView++; if (m.callouts.length) withCallouts++;
    const step: ImportedGuideStep = { sequenceNumber: steps.length + 1, title, text: body, completionRequired: true };
    if (m.nodes.length) step.nodes = m.nodes.map(pruneNode);
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
    if (m.view) step.view = m.view;
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
      // (RWI numbers its steps) — then the Simulation Step's own title.
      const simStep = subs[0]?.stepId ? inter?.textById.get(subs[0].stepId)?.title : undefined;
      const candidates = [wi.path[0], simStep, subs[0]?.stepTitle].filter((x): x is string => !!x);
      const top = candidates.find(x => !/^[\d.\s]+$/.test(x));
      let leaf = wi.title; let text = wi.text ?? wi.comment ?? '';
      // No Description but the Text opens with a short heading line (DITA/RWI <h3>) — promote it.
      if ((!leaf || /^[\d.\s]+$/.test(leaf)) && text.includes('\n')) {
        const [first, ...rest] = text.split('\n'); const restText = rest.join('\n').trim();
        if (first.length <= 80 && restText) { leaf = leaf && !/^[\d.\s]+$/.test(leaf) ? leaf : first.trim(); text = restText; }
      }
      const title = (top ? [`${wi.topIndex}. ${top}`, leaf && leaf !== top ? leaf : undefined] : [leaf ? `${wi.topIndex}. ${leaf}` : undefined]).filter(Boolean).join(' — ') || `Step ${wi.topIndex}`;
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
  };
  if (scene.bbox) {
    const ext = log.scene.extentM!; const maxExt = Math.max(...ext);
    if (maxExt > 50) warnings.push(`scene extent ${maxExt.toFixed(1)} m — units may be millimetres, not metres`);
    if (maxExt < 0.01) warnings.push(`scene extent ${maxExt} m — model is tiny; check units`);
  }
  if (rwi && rwi.stepCount === 0 && rwi.taskCount > 0) { /* expected: rwi is not a step source */ }

  const bounds = scene.bbox ? { min: scene.bbox.min.map(round5) as [number, number, number], max: scene.bbox.max.map(round5) as [number, number, number] } : undefined;
  return { imported, glb, log, extras, initialNodes, bounds };
}

function subStepTitle(ss: ExtractedSubStep, inter: InteractivityIndex | null): string {
  const it = ss.id ? inter?.textById.get(ss.id) : undefined;
  const stepIt = ss.stepId ? inter?.textById.get(ss.stepId) : undefined;
  const subTitle = it?.title ?? ss.title; const stepTitle = stepIt?.title ?? ss.stepTitle;
  return [stepTitle && `${ss.stepIndex}. ${stepTitle}`, subTitle && subTitle !== stepTitle ? subTitle : undefined]
    .filter(Boolean).join(' — ') || `Step ${ss.stepIndex}.${ss.subIndex}`;
}
function subStepText(ss: ExtractedSubStep, inter: InteractivityIndex | null): string {
  const it = ss.id ? inter?.textById.get(ss.id) : undefined;
  const stepIt = ss.stepId ? inter?.textById.get(ss.stepId) : undefined;
  return it?.text ?? it?.comment ?? ss.comment ?? stepIt?.text ?? stepIt?.comment ?? ss.stepComment ?? '';
}

/** Merge the deltas of several animation sub-steps played in sequence into one
 *  step's presentation: last state wins for show/opacity/colour, motion spans
 *  first `from` → last `to`, insert/remove outrank plain moves, durations add. */
function mergeSubsteps(subs: ExtractedSubStep[]): { nodes: GuideStepNode[]; view?: GuideStepView; callouts: string[]; durationSec?: number } {
  const byNode = new Map<string, GuideStepNode>(); const nodes: GuideStepNode[] = [];
  let view: GuideStepView | undefined; const callouts: string[] = []; let dur = 0;
  const rank = { insert: 3, remove: 3, move: 1 } as const;
  for (const ss of subs) {
    for (const n of ss.nodes) {
      let g = byNode.get(n.node); if (!g) { g = { node: n.node }; byNode.set(n.node, g); nodes.push(g); }
      if (n.show !== undefined) { g.show = n.show; g.opacity = n.opacity; }
      if (n.color) g.color = n.color;
      if (n.from && !g.from) g.from = n.from;
      if (n.to) g.to = n.to;
      if (n.rotationFrom && !g.rotationFrom) g.rotationFrom = n.rotationFrom;
      if (n.rotationTo) g.rotationTo = n.rotationTo;
      if (n.animate && (!g.animate || rank[n.animate] >= rank[g.animate])) g.animate = n.animate;
      if (n.sourceKey && !g.sourceKey) g.sourceKey = n.sourceKey;
      if (n.durationSec) g.durationSec = (g.durationSec ?? 0) + n.durationSec;
    }
    if (ss.view) view = ss.view;
    for (const c of ss.callouts) if (!callouts.includes(c)) callouts.push(c);
    if (ss.durationSec) dur += ss.durationSec;
  }
  for (const g of nodes) if (g.opacity === undefined) delete g.opacity;
  return { nodes, view, callouts, durationSec: dur || undefined };
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

function pruneNode(n: GuideStepNode): GuideStepNode {
  const o: GuideStepNode = { node: n.node };
  for (const k of ['show', 'opacity', 'animate', 'from', 'to', 'rotationFrom', 'rotationTo', 'color', 'durationSec', 'sourceKey'] as const) {
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
