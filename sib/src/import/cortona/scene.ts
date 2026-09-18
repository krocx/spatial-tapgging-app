// scene.ts — turn the parsed VRML AST into a renderable scene graph.
//
// Cortona3D's published scene expresses the assembly as `ObjectVM` PROTO
// instances (their own Transform-with-extras) plus standard `Transform`,
// `Group` and `Switch` nodes, with flat `Shape { IndexedFaceSet }` leaves.
// PROTO instances that are annotation widgets, sequencers, players, panels,
// viewpoints etc. carry no part geometry and are skipped here (they are
// accounted for in the import log by procedure.ts).

import { createHash } from 'crypto';
import {
  type VrmlNode, type VrmlUse, type VrmlScene,
  numField, strField, boolField, nodeField, nodesField,
} from './vrml.js';
import { PRIMITIVE_TYPES, buildPrimitive } from './primitives.js';

export interface SceneMesh {
  positions:    Float32Array;   // xyz triples
  indices:      Uint32Array;    // triangles
  color:        [number, number, number];
  transparency: number;         // 0 opaque … 1 invisible
}

export interface SceneNode {
  id:          string;           // DEF name, or synthesized `n<index>`
  def?:        string;
  type:        string;           // Transform | Group | Switch | ObjectVM | Shape | …
  name?:       string;           // ObjectVM.name (display name), if any
  matrix:      number[];         // 4x4 column-major local transform
  visible:     boolean;          // false when under a Switch with whichChoice -1 (initial state)
  meshes:      SceneMesh[];
  children:    SceneNode[];
  vrml:        VrmlNode;
}

export interface SceneGraph {
  roots:        SceneNode[];
  byDef:        Map<string, SceneNode>;
  meshCount:    number;
  triangleCount: number;
  bbox:         { min: number[]; max: number[] } | null;
  /** World-space (assembly frame) bounds per DEF'd node, over its whole subtree. */
  boundsByDef:  Map<string, { min: number[]; max: number[] }>;
}

/** Node types treated as transform containers. Anything else is skipped as non-geometry. */
const CONTAINER_TYPES = new Set(['Transform', 'Group', 'Switch', 'ObjectVM', 'Collision', 'Billboard', 'Anchor']);
const MESH_TYPES      = new Set(['IndexedFaceSet', 'IndexedFaceSetWithEdges']);

export function buildScene(scene: VrmlScene): SceneGraph {
  const byDef = new Map<string, SceneNode>();
  const meshCache = new Map<VrmlNode, SceneMesh | null>();
  const meshByContent = new Map<string, SceneMesh>();   // content-addressed dedupe (the exporter emits identical copies)
  let counter = 0; let meshCount = 0; let triangleCount = 0;
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  const resolve = (n: VrmlNode | VrmlUse): VrmlNode | null =>
    'use' in n ? (scene.defs.get(n.use) ?? null) : n;

  function shapeMesh(shape: VrmlNode): SceneMesh | null {
    const geomRef = nodeField(shape, 'geometry'); if (!geomRef) return null;
    const geom = resolve(geomRef); if (!geom) return null;
    const isPrim = PRIMITIVE_TYPES.has(geom.type);
    if (!isPrim && !MESH_TYPES.has(geom.type)) return null;
    if (meshCache.has(geom)) return meshCache.get(geom)!;
    let pts: number[] = []; const tris: number[] = [];
    if (isPrim) {
      const prim = buildPrimitive(geom.type, (name, fb) => numField(geom, name, fb));
      if (!prim) { meshCache.set(geom, null); return null; }
      pts = prim.positions; tris.push(...prim.indices);
    } else {
      const coordRef = nodeField(geom, 'coord'); const coord = coordRef ? resolve(coordRef) : null;
      pts = coord ? numField(coord, 'point', []) : [];
      const idx = numField(geom, 'coordIndex', []);
      const ccw = boolField(geom, 'ccw') ?? true;
      let face: number[] = [];
      const flush = () => {
        for (let k = 1; k + 1 < face.length; k++) {
          if (ccw) tris.push(face[0], face[k], face[k + 1]); else tris.push(face[0], face[k + 1], face[k]);
        }
        face = [];
      };
      for (const v of idx) { if (v < 0) flush(); else face.push(v); }
      flush();
    }
    if (!pts.length || !tris.length) { meshCache.set(geom, null); return null; }
    const maxIndex = pts.length / 3 - 1;
    const safe = tris.every(t => t <= maxIndex);
    // material
    let color: [number, number, number] = [0.8, 0.8, 0.8]; let transparency = 0;
    const appRef = nodeField(shape, 'appearance'); const app = appRef ? resolve(appRef) : null;
    const matRef = app ? nodeField(app, 'material') : null; const mat = matRef ? resolve(matRef) : null;
    if (mat) {
      const dc = numField(mat, 'diffuseColor', []); if (dc.length === 3) color = [dc[0], dc[1], dc[2]];
      const tr = numField(mat, 'transparency', []); if (tr.length === 1) transparency = tr[0];
    }
    const positions = Float32Array.from(pts);
    const indices   = Uint32Array.from(safe ? tris : tris.filter((_, i, a) => a[i - (i % 3)] <= maxIndex && a[i - (i % 3) + 1] <= maxIndex && a[i - (i % 3) + 2] <= maxIndex));
    const key = createHash('sha1')
      .update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength))
      .update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength))
      .update(`${color.join(',')}|${transparency}`).digest('hex');
    let mesh = meshByContent.get(key);
    if (!mesh) {
      mesh = { positions, indices, color, transparency };
      meshByContent.set(key, mesh);
      meshCount++; triangleCount += mesh.indices.length / 3;
    }
    meshCache.set(geom, mesh);
    return mesh;
  }

  function build(n: VrmlNode, inheritedVisible: boolean): SceneNode | null {
    const sn: SceneNode = {
      id: n.def ?? `n${counter++}`, def: n.def, type: n.type,
      matrix: localMatrix(n), visible: inheritedVisible, meshes: [], children: [], vrml: n,
    };
    const name = strField(n, 'name'); if (name) sn.name = name;
    if (n.def) byDef.set(n.def, sn);

    if (n.type === 'Shape') {
      const m = shapeMesh(n); if (m) sn.meshes.push(m);
      return sn;
    }
    if (!CONTAINER_TYPES.has(n.type)) return null; // PROTO widgets / sensors / scripts: skipped

    // ObjectVM may carry geometry directly (appearance + geometry fields)
    if (n.type === 'ObjectVM' && nodeField(n, 'geometry')) {
      const m = shapeMesh(n); if (m) sn.meshes.push(m);
    }

    let which = -2; // -2 = not a switch
    if (n.type === 'Switch' || n.type === 'ObjectVM') {
      const w = numField(n, 'whichChoice', []); if (w.length) which = w[0];
    }
    const kids = n.type === 'Switch' ? nodesField(n, 'choice') : nodesField(n, 'children');
    kids.forEach((k, i) => {
      const kn = resolve(k); if (!kn) return;
      // Switch semantics: only choice[whichChoice] visible; ObjectVM.whichChoice -1 hides children.
      let vis = inheritedVisible;
      if (n.type === 'Switch') vis = vis && which === i;
      else if (which === -1) vis = false;
      const c = build(kn, vis); if (c) sn.children.push(c);
    });
    return sn;
  }

  const roots: SceneNode[] = [];
  for (const n of scene.nodes) { const r = build(n, true); if (r) roots.push(r); }

  // bbox over world-space positions — overall, and per DEF'd subtree (the
  // per-node bounds give each imported step its pin: the centroid of the
  // parts it touches, in the assembly frame).
  const boundsByDef = new Map<string, { min: number[]; max: number[] }>();
  const grow = (b: { min: number[]; max: number[] }, wx: number, wy: number, wz: number) => {
    if (wx < b.min[0]) b.min[0] = wx; if (wx > b.max[0]) b.max[0] = wx;
    if (wy < b.min[1]) b.min[1] = wy; if (wy > b.max[1]) b.max[1] = wy;
    if (wz < b.min[2]) b.min[2] = wz; if (wz > b.max[2]) b.max[2] = wz;
  };
  const stack: { node: SceneNode; m: number[]; defs: string[] }[] = roots.map(r => ({ node: r, m: r.matrix, defs: r.def ? [r.def] : [] }));
  while (stack.length) {
    const { node, m, defs } = stack.pop()!;
    const owners = defs.map(d => { let b = boundsByDef.get(d); if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; boundsByDef.set(d, b); } return b; });
    for (const mesh of node.meshes) {
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        const wx = m[0] * x + m[4] * y + m[8]  * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9]  * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        grow(bbox, wx, wy, wz);
        for (const b of owners) grow(b, wx, wy, wz);
      }
    }
    for (const c of node.children) stack.push({ node: c, m: mul(m, c.matrix), defs: c.def ? [...defs, c.def] : defs });
  }
  for (const [d, b] of boundsByDef) if (!Number.isFinite(b.min[0])) boundsByDef.delete(d);
  return { roots, byDef, meshCount, triangleCount, bbox: Number.isFinite(bbox.min[0]) ? bbox : null, boundsByDef };
}

// ── Transforms ──────────────────────────────────────────────────────────────

/** VRML Transform: T · C · R · SR · S · -SR · -C  (column-major 4x4). */
export function localMatrix(n: VrmlNode): number[] {
  const t  = numField(n, 'translation', [0, 0, 0]);
  const r  = numField(n, 'rotation', [0, 0, 1, 0]);
  const s  = numField(n, 'scale', [1, 1, 1]);
  const c  = numField(n, 'center', [0, 0, 0]);
  const so = numField(n, 'scaleOrientation', [0, 0, 1, 0]);
  let m = translation(t[0], t[1], t[2]);
  m = mul(m, translation(c[0], c[1], c[2]));
  m = mul(m, axisAngle(r));
  const hasSO = so[3] !== 0;
  if (hasSO) m = mul(m, axisAngle(so));
  m = mul(m, scaleM(s[0], s[1], s[2]));
  if (hasSO) m = mul(m, axisAngle([so[0], so[1], so[2], -so[3]]));
  m = mul(m, translation(-c[0], -c[1], -c[2]));
  return m;
}

export function identity(): number[] { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
export function translation(x: number, y: number, z: number): number[] { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
export function scaleM(x: number, y: number, z: number): number[] { const m = identity(); m[0] = x; m[5] = y; m[10] = z; return m; }
export function axisAngle(r: number[]): number[] {
  let [x, y, z] = r; const a = r[3] ?? 0;
  const len = Math.hypot(x, y, z) || 1; x /= len; y /= len; z /= len;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    t*x*x + c,   t*x*y + s*z, t*x*z - s*y, 0,
    t*x*y - s*z, t*y*y + c,   t*y*z + s*x, 0,
    t*x*z + s*y, t*y*z - s*x, t*z*z + c,   0,
    0, 0, 0, 1,
  ];
}
export function mul(a: number[], b: number[]): number[] {
  const o = new Array<number>(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    o[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
  }
  return o;
}
export function isIdentity(m: number[]): boolean {
  const I = identity(); return m.every((v, i) => Math.abs(v - I[i]) < 1e-9);
}
/** axis-angle → quaternion [x,y,z,w] */
export function quatFromAxisAngle(r: number[]): [number, number, number, number] {
  let [x, y, z] = r; const a = r[3] ?? 0; const len = Math.hypot(x, y, z) || 1;
  const s = Math.sin(a / 2); return [x / len * s, y / len * s, z / len * s, Math.cos(a / 2)];
}
