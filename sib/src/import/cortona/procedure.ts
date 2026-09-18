// procedure.ts — extract steps and per-node presentation from the PROTO tree.
//
// Published Cortona3D scenes carry the procedure as PROTO instances:
//   Procedure { title comment id steps [ Step … ] }
//   Step      { title comment id simulate substeps [ SubStep … ] }
//   SubStep   { title comment id duration commands [ <command> … ] }
// where each command is a DEF'd PROTO instance sharing one interface —
//   key (MFFloat normalised times), keyValue (typed per command), period,
//   objectID (opaque numeric key), attributeName (channel), value_changed —
// and is bound to its target part by  ROUTE <cmdDEF>.value_changed TO <targetDEF>.<field>.
//
// This module resolves that into SIB's step model: one guide step per SubStep
// (the level that carries duration and commands — 210 = 210 across the two
// side files in both samples), grouped under its Step, with `nodes[]` deltas
// per targeted part. Two commands make up two-thirds of every deck seen so
// far (SwitchOFF, Set_transparency); those map to `show`; motion commands map
// to from/to; camera commands to `view`; colour to `color`.
//
// Unknown PROTO types are NEVER silently dropped: every PROTO name seen in
// the scene is classified handled / ignored (known non-procedural widgets) /
// unknown, and the caller decides whether unknown is fatal (strict mode).

import type { GuideStepNode, GuideStepView } from '@spatial/shared';
import {
  type VrmlNode, type VrmlScene, type VrmlRoute,
  numField, strField, boolField, nodesField, walkNodes,
} from './vrml.js';

export interface ExtractedSubStep {
  id?:          string;
  title?:       string;
  comment?:     string;
  stepId?:      string;
  stepTitle?:   string;
  stepComment?: string;
  stepIndex:    number;      // 1-based index of parent Step
  subIndex:     number;      // 1-based index within Step
  /** Parent Step has simulate FALSE: scene set-up commands, never shown to the operator. */
  setup:        boolean;
  durationSec?: number;
  nodes:        GuideStepNode[];
  view?:        GuideStepView;
  /** Plain text of annotation widgets this substep reveals (callouts, panels). */
  callouts:     string[];
  /** DEFs of widgets revealed (for a future node-bound tag import). */
  calloutDefs:  string[];
  /** objectIDs referenced by commands whose ROUTE did not resolve to a DEF */
  unresolved:   number;
}

export interface ProtoClassification {
  handled:  string[];
  ignored:  string[];
  unknown:  string[];
  counts:   Record<string, number>;   // instance count per PROTO type
}

export interface ExtractedProcedure {
  title?:       string;
  comment?:     string;
  id?:          string;
  stepCount:    number;
  substeps:     ExtractedSubStep[];
  commandCounts: Record<string, number>;
  routeCount:   number;
  unresolvedRoutes: number;
  /** DEF → objectID learned from commands (for GLB extras / DocItems join) */
  objectIdByDef: Map<string, number>;
  protos:       ProtoClassification;
}

// PROTO types whose semantics we implement.
export const HANDLED_PROTOS = new Set([
  'Procedure', 'Step', 'SubStep', 'ObjectVM',
  'Set_translation', 'Set_rotation', 'Set_transparency', 'SwitchOFF', 'Set_center',
  'Set_diffuseColor', 'Set_Viewpoint', 'Set_Viewpoint2', 'Set_scale',
  // parametric geometry PROTOs rendered by scene.ts / primitives.ts
  'BOX', 'SPHERE', 'CYLNDR', 'TORUS', 'WASHER', 'BOXDUMMY',
]);
// Known non-procedural PROTOs (annotation widgets, viewer chrome, sequencers,
// sectioning tools, typed-field helpers). Counted, logged, not imported.
export const IGNORED_PROTO_PATTERNS: RegExp[] = [
  /^PanelImg\d*$/, /^PanelHtml\d*$/, /^CalloutM\d*$/, /^VMTighten\d*$/, /^VMRope\d*$/, /^Set_Arrow\d*$/,
  /^VMSectionPlane$/, /^ClippingPlane(Canceller)?$/, /^CompositeTexture3D$/, /^Loupe\d*$/, /^ScreenedShape$/,
  /^IntegerSequencer$/, /^Layer3D$/, /^OrthographicViewpoint$/, /^Transform2D$/, /^Viewpoint3$/, /^WorldInfo\d*$/,
  /^(Old)?AxesPanel$/, /^Slider$/, /^Button$/, /^protoSimulationPlayer$/, /^protoSF\w+$/, /^protoMF\w+$/,
  /^IndexedFaceSetWithEdges$/, /^Panel$/, /^HTMLText$/, /^TransformSensor$/, /^ViewportSensor$/,
  /^Set_ID$/,              // command that relabels a part's ID for the viewer HUD — no presentation effect
  /^Set_emissiveColor$/,   // highlight "flash" effect — transient, not a state change
  /^HoseSplineFlow\d*$/, /^VMHose\d*$/, /^CableFlat\d*$/,   // procedural hose/cable/spring sweeps — not rendered; counted in the log
  /^(Animated)?Arrow\d*$/, /^VMDimension\d*$/,              // annotation widgets (arrows, dimension lines)
];

export function classifyProtos(scene: VrmlScene): ProtoClassification {
  const counts: Record<string, number> = {};
  walkNodes(scene.nodes, n => { if (scene.protos.has(n.type)) counts[n.type] = (counts[n.type] ?? 0) + 1; });
  const handled: string[] = [], ignored: string[] = [], unknown: string[] = [];
  for (const name of scene.protos.keys()) {
    if (HANDLED_PROTOS.has(name)) handled.push(name);
    else if (IGNORED_PROTO_PATTERNS.some(re => re.test(name))) ignored.push(name);
    else if ((counts[name] ?? 0) > 0) unknown.push(name);   // declared AND instantiated
  }
  return { handled: handled.sort(), ignored: ignored.sort(), unknown: unknown.sort(), counts };
}

// ── Extraction ───────────────────────────────────────────────────────────────

const MOTION_EPS = 1e-6;

export function extractProcedure(scene: VrmlScene, widgetText: Map<string, string | undefined> = new Map()): ExtractedProcedure {
  const routesByFrom = new Map<string, VrmlRoute[]>();
  for (const r of scene.routes) {
    const list = routesByFrom.get(r.fromNode) ?? []; list.push(r); routesByFrom.set(r.fromNode, list);
  }

  const procedures: VrmlNode[] = [];
  walkNodes(scene.nodes, n => { if (n.type === 'Procedure') procedures.push(n); });
  // Sample 2 shows 2 Procedure instances (one is a player wrapper); prefer the one with steps.
  const proc = procedures.sort((a, b) => nodesField(b, 'steps').length - nodesField(a, 'steps').length)[0];

  const out: ExtractedProcedure = {
    stepCount: 0, substeps: [], commandCounts: {}, routeCount: scene.routes.length, unresolvedRoutes: 0,
    objectIdByDef: new Map(), protos: classifyProtos(scene),
  };
  if (!proc) return out;
  out.title = strField(proc, 'title'); out.comment = strField(proc, 'comment'); out.id = strField(proc, 'id');

  const resolve = (n: VrmlNode | { use: string }): VrmlNode | null => 'use' in n ? scene.defs.get(n.use) ?? null : n;
  const steps = nodesField(proc, 'steps').map(resolve).filter((s): s is VrmlNode => !!s && s.type === 'Step');
  out.stepCount = steps.length;

  steps.forEach((step, si) => {
    const subs = nodesField(step, 'substeps').map(resolve).filter((s): s is VrmlNode => !!s && s.type === 'SubStep');
    subs.forEach((sub, ki) => {
      const dur = numField(sub, 'duration', []);
      const ss: ExtractedSubStep = {
        id: strField(sub, 'id'), title: strField(sub, 'title'), comment: strField(sub, 'comment'),
        stepId: strField(step, 'id'), stepTitle: strField(step, 'title'), stepComment: strField(step, 'comment'),
        stepIndex: si + 1, subIndex: ki + 1, setup: boolField(step, 'simulate') === false,
        durationSec: dur.length && dur[0] > 0 ? dur[0] : undefined,
        nodes: [], callouts: [], calloutDefs: [], unresolved: 0,
      };
      const byNode = new Map<string, GuideStepNode>();
      const nodeFor = (def: string): GuideStepNode => {
        let g = byNode.get(def); if (!g) { g = { node: `cmp:${def}` }; byNode.set(def, g); ss.nodes.push(g); }
        return g;
      };
      for (const cmdRef of nodesField(sub, 'commands')) {
        const cmd = resolve(cmdRef); if (!cmd) continue;
        out.commandCounts[cmd.type] = (out.commandCounts[cmd.type] ?? 0) + 1;
        if (cmd.type === 'Set_Viewpoint' || cmd.type === 'Set_Viewpoint2') { ss.view = viewpointOf(cmd); continue; }
        if (!HANDLED_PROTOS.has(cmd.type) || cmd.type === 'ObjectVM') continue;
        const routes = cmd.def ? (routesByFrom.get(cmd.def) ?? []).filter(r => r.fromField === 'value_changed') : [];
        const oid = numField(cmd, 'objectID', []); const objectID = oid.length ? oid[0] : undefined;
        if (!routes.length) { ss.unresolved++; out.unresolvedRoutes++; continue; }
        for (const r of routes) {
          if (!scene.defs.has(r.toNode)) { ss.unresolved++; out.unresolvedRoutes++; continue; }
          if (widgetText.has(r.toNode)) {
            // A widget being revealed: its words belong to this substep, not to a part.
            const probe: GuideStepNode = { node: r.toNode }; applyCommand(cmd, r.toField, probe, ss.durationSec);
            if (probe.show !== 'hidden' && !ss.calloutDefs.includes(r.toNode)) {
              ss.calloutDefs.push(r.toNode);
              const t = widgetText.get(r.toNode); if (t) ss.callouts.push(t);
            }
            continue;
          }
          const g = nodeFor(r.toNode);
          if (objectID !== undefined) { g.sourceKey = String(objectID); out.objectIdByDef.set(r.toNode, objectID); }
          applyCommand(cmd, r.toField, g, ss.durationSec);
        }
      }
      out.substeps.push(ss);
    });
  });
  return out;
}

function applyCommand(cmd: VrmlNode, toField: string, g: GuideStepNode, durationSec?: number): void {
  const keyValue = numField(cmd, 'keyValue', []);
  const period   = numField(cmd, 'period', []);
  const dur = period.length >= 2 ? period[1] - period[0] : period.length === 1 ? period[0] : undefined;
  if (dur && dur > 0) g.durationSec = dur; else if (durationSec) g.durationSec = durationSec;

  switch (cmd.type) {
    case 'SwitchOFF': {
      // whichChoice: -1 hides. keyValue may be absent (implicit off) or [-1]/[0].
      const last = keyValue.length ? keyValue[keyValue.length - 1] : -1;
      g.show = last < 0 ? 'hidden' : 'solid';
      return;
    }
    case 'Set_transparency': {
      const last = keyValue.length ? keyValue[keyValue.length - 1] : 0;
      if (last >= 0.99) g.show = 'hidden';
      else if (last > 0.01) { g.show = 'ghost'; g.opacity = round(1 - last); }
      else g.show = 'solid';
      return;
    }
    case 'Set_translation': {
      if (keyValue.length >= 3) {
        const from: [number, number, number] = [keyValue[0], keyValue[1], keyValue[2]];
        const n = keyValue.length - (keyValue.length % 3);
        const to: [number, number, number] = [keyValue[n - 3], keyValue[n - 2], keyValue[n - 1]];
        g.from = from.map(round) as [number, number, number]; g.to = to.map(round) as [number, number, number];
        const moved = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) > MOTION_EPS;
        if (moved && !g.animate) g.animate = 'move';
      }
      return;
    }
    case 'Set_rotation': {
      if (keyValue.length >= 4) {
        const n = keyValue.length - (keyValue.length % 4);
        g.rotationFrom = [keyValue[0], keyValue[1], keyValue[2], keyValue[3]].map(round) as GuideStepNode['rotationFrom'];
        g.rotationTo   = [keyValue[n - 4], keyValue[n - 3], keyValue[n - 2], keyValue[n - 1]].map(round) as GuideStepNode['rotationTo'];
        if (!g.animate && Math.abs(g.rotationTo![3] - g.rotationFrom![3]) > MOTION_EPS) g.animate = 'move';
      }
      return;
    }
    case 'Set_diffuseColor': {
      if (keyValue.length >= 3) { const n = keyValue.length - (keyValue.length % 3); g.color = [keyValue[n - 3], keyValue[n - 2], keyValue[n - 1]].map(round) as [number, number, number]; }
      return;
    }
    case 'Set_center': case 'Set_scale':
      return; // geometric bookkeeping; no presentation delta
    default:
      // toField tells us what the command drives when the type is unfamiliar
      if (toField === 'whichChoice') g.show = 'hidden';
  }
}

function viewpointOf(cmd: VrmlNode): GuideStepView {
  const v: GuideStepView = {};
  const p = numField(cmd, 'position', []); if (p.length === 3) v.position = [p[0], p[1], p[2]].map(round) as GuideStepView['position'];
  const o = numField(cmd, 'orientation', []); if (o.length === 4) v.orientation = [o[0], o[1], o[2], o[3]].map(round) as GuideStepView['orientation'];
  const c = numField(cmd, 'center', []); if (c.length === 3) v.center = [c[0], c[1], c[2]].map(round) as GuideStepView['center'];
  const f = numField(cmd, 'fieldOfView', []); if (f.length === 1) v.fieldOfView = round(f[0]);
  const ortho = boolField(cmd, 'orthographic'); if (ortho !== undefined) v.orthographic = ortho;
  return v;
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Second pass over a whole procedure: classify motion as insert/remove by
 *  comparing the animated end pose with the part's rest pose (its scene
 *  transform). Ends at rest → 'insert' (installing); starts at rest → 'remove'. */
export function classifyMotion(proc: ExtractedProcedure, restTranslationByDef: Map<string, number[]>): void {
  for (const ss of proc.substeps) for (const g of ss.nodes) {
    if (!g.from || !g.to) continue;
    const def = g.node.replace(/^cmp:/, ''); const rest = restTranslationByDef.get(def); if (!rest) continue;
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const endAtRest = d(g.to, rest) < 1e-4, startAtRest = d(g.from, rest) < 1e-4;
    if (endAtRest && !startAtRest) g.animate = 'insert';
    else if (startAtRest && !endAtRest) g.animate = 'remove';
  }
}
