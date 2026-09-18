// importer.ts — published Cortona3D RapidManual .htm → ImportedGuide + assembly GLB.
//
// Pipeline (docs/ar-ojt/CORTONA3D-IMPORT.md, Stage 2):
//   .htm ─▶ solo+zip bundle ─▶ VRML97 (PROTOs kept) ─▶ scene graph ─▶ GLB
//                          └▶ interactivity.xml / rwi ─▶ text, part numbers
//   Procedure → Step → SubStep → commands ─▶ one guide step per SubStep with
//   nodes[] deltas, suggested view, callout text, duration.
//
// The import log is CONTENT-FREE by construction: counts, PROTO type names,
// publish option names, warnings — never step text, part numbers or ids.

import type { ImportedGuide, ImportedGuideStep, GuideStepNode } from '@spatial/shared';
import { readCortonaBundle, type CortonaBundle } from './bundle.js';
import { parseVrml, numField } from './vrml.js';
import { buildScene } from './scene.js';
import { writeGlb, type NodeExtras } from './glb.js';
import { extractProcedure, classifyMotion, type ExtractedProcedure } from './procedure.js';
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
  procedure:   { steps: number; substeps: number; commands: Record<string, number>; unresolvedRoutes: number; withView: number; withCallouts: number };
  text:        { substepsWithTitle: number; substepsWithText: number; fromInteractivity: number };
  parts:       { docItems: number; rwiBomRows: number; nodesWithObjectId: number; nodesWithPartNumber: number };
  publish:     Record<string, string>;
  warnings:    string[];
  strict:      boolean;
}

export interface CortonaImportResult {
  imported:  ImportedGuide;
  glb:       Buffer;
  log:       CortonaImportLog;
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
  const hoses = Object.entries(proc.protos.counts).filter(([k]) => /^HoseSplineFlow\d*$/.test(k)).reduce((a, [, n]) => a + n, 0);
  if (hoses) warnings.push(`${hoses} procedural hose/cable object(s) (HoseSplineFlow) are not rendered in the assembly model`);

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

  // steps
  let fromInter = 0, withTitle = 0, withText = 0, withView = 0, withCallouts = 0;
  const steps: ImportedGuideStep[] = proc.substeps.map((ss, i) => {
    const it = ss.id ? inter?.textById.get(ss.id) : undefined;
    const stepIt = ss.stepId ? inter?.textById.get(ss.stepId) : undefined;
    if (it) fromInter++;
    const subTitle  = it?.title ?? ss.title;
    const stepTitle = stepIt?.title ?? ss.stepTitle;
    const title = [stepTitle && `${ss.stepIndex}. ${stepTitle}`, subTitle && subTitle !== stepTitle ? subTitle : undefined]
      .filter(Boolean).join(' — ') || `Step ${ss.stepIndex}.${ss.subIndex}`;
    const bodyParts = [it?.text, it?.comment, ss.comment, ...ss.callouts]
      .map(s => (s ?? '').trim()).filter(Boolean);
    const dedup = bodyParts.filter((s, k) => bodyParts.indexOf(s) === k);
    let text = dedup.join('\n\n');
    if (!text) text = stepIt?.text ?? stepIt?.comment ?? ss.stepComment ?? title;
    if (subTitle || stepTitle) withTitle++; if (dedup.length) withText++;
    if (ss.view) withView++; if (ss.callouts.length) withCallouts++;

    const step: ImportedGuideStep = { sequenceNumber: i + 1, title, text, completionRequired: true };
    if (ss.nodes.length) step.nodes = ss.nodes.map(pruneNode);
    if (ss.view) step.view = ss.view;
    if (ss.durationSec) step.durationSec = ss.durationSec;
    return step;
  });

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
    procedure: { steps: proc.stepCount, substeps: proc.substeps.length, commands: proc.commandCounts, unresolvedRoutes: proc.unresolvedRoutes, withView, withCallouts },
    text:   { substepsWithTitle: withTitle, substepsWithText: withText, fromInteractivity: fromInter },
    parts:  { docItems: inter?.partByObjectID.size ?? 0, rwiBomRows: rwi?.bom.length ?? 0, nodesWithObjectId: proc.objectIdByDef.size, nodesWithPartNumber: nodesWithPart },
    publish, warnings, strict: !!opts.strict,
  };
  if (scene.bbox) {
    const ext = log.scene.extentM!; const maxExt = Math.max(...ext);
    if (maxExt > 50) warnings.push(`scene extent ${maxExt.toFixed(1)} m — units may be millimetres, not metres`);
    if (maxExt < 0.01) warnings.push(`scene extent ${maxExt} m — model is tiny; check units`);
  }
  if (rwi && rwi.stepCount === 0 && rwi.taskCount > 0) { /* expected: rwi is not a step source */ }

  return { imported, glb, log, extras };
}

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
