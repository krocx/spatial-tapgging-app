// models/glb-nodes.ts — the part tree of a GLB, read from its JSON chunk.
//
// The Procedure Designer's parts picker needs node NAMES and hierarchy, not
// pixels: a GLB is `12-byte header · JSON chunk · BIN chunk`, so the whole
// tree comes from parsing the first chunk. No renderer, no GPU, no third-party
// loader — the same node names the iOS assembly loader registers as parts.
//
// Proprietary & Confidential · Applied Materials.

export interface GlbPartNode {
  /** glTF node name (or `node<i>` when the exporter left it blank). */
  name:     string;
  /** glTF node index — stable within the file. */
  index:    number;
  /** True when this node (not a descendant) carries a mesh. */
  mesh:     boolean;
  /** Part number / description when the exporter wrote extras. */
  extras?:  Record<string, unknown>;
  children: GlbPartNode[];
}

export interface GlbPartTree {
  roots:      GlbPartNode[];
  /** Every node name, depth-first — the flat list the picker searches. */
  names:      string[];
  nodeCount:  number;
  meshCount:  number;
}

const MAGIC = 0x46546c67; // 'glTF'

export function readGlbJson(buf: Buffer): Record<string, unknown> {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) throw new Error('Not a GLB (bad magic)');
  const chunkLen  = buf.readUInt32LE(12);
  const chunkType = buf.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) throw new Error('First GLB chunk is not JSON');
  if (20 + chunkLen > buf.length) throw new Error('GLB JSON chunk truncated');
  return JSON.parse(buf.subarray(20, 20 + chunkLen).toString('utf8')) as Record<string, unknown>;
}

/** Build the part tree from parsed glTF JSON. Pure; safe on any input shape. */
export function partTreeOf(gltf: Record<string, unknown>): GlbPartTree {
  const nodesJ = Array.isArray(gltf.nodes) ? gltf.nodes as Array<Record<string, unknown>> : [];
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes as Array<{ nodes?: number[] }> : [];
  const sceneIx = typeof gltf.scene === 'number' ? gltf.scene : 0;
  const rootIx: number[] = scenes[sceneIx]?.nodes ?? scenes[0]?.nodes ?? nodesJ.map((_, i) => i);

  const names: string[] = [];
  let meshCount = 0;
  const seen = new Set<number>();

  const build = (i: number): GlbPartNode | null => {
    if (seen.has(i) || i < 0 || i >= nodesJ.length) return null;   // cycles / bad refs
    seen.add(i);
    const nj = nodesJ[i];
    const name = typeof nj.name === 'string' && nj.name.trim() ? nj.name : `node${i}`;
    const mesh = typeof nj.mesh === 'number';
    if (mesh) meshCount++;
    names.push(name);
    const kids = Array.isArray(nj.children) ? (nj.children as number[]) : [];
    const node: GlbPartNode = { name, index: i, mesh, children: [] };
    if (nj.extras && typeof nj.extras === 'object') node.extras = nj.extras as Record<string, unknown>;
    for (const k of kids) { const c = build(k); if (c) node.children.push(c); }
    return node;
  };

  const roots: GlbPartNode[] = [];
  for (const r of rootIx) { const n = build(r); if (n) roots.push(n); }
  // Orphans (nodes in no scene) still count as parts — some exporters omit `scenes`.
  for (let i = 0; i < nodesJ.length; i++) if (!seen.has(i)) { const n = build(i); if (n) roots.push(n); }

  return { roots, names, nodeCount: names.length, meshCount };
}

export function partTreeFromGlb(buf: Buffer): GlbPartTree {
  return partTreeOf(readGlbJson(buf));
}

// ── Part bounds (assembly frame) ─────────────────────────────────────────────
//
// glTF requires `min` / `max` on every POSITION accessor, so a part's bounding
// box comes from the JSON chunk too: transform each mesh's 8 box corners by
// the node's world matrix and union over the subtree. Good enough to put a
// step pin at the centre of the parts it installs — no buffer decoding.

export type Vec3 = [number, number, number];
export interface Bounds { min: Vec3; max: Vec3 }
type Mat4 = number[]; // column-major, 16

const I4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}

function localMatrix(nj: Record<string, unknown>): Mat4 {
  if (Array.isArray(nj.matrix) && nj.matrix.length === 16) return nj.matrix as Mat4;
  const t = (Array.isArray(nj.translation) ? nj.translation : [0, 0, 0]) as number[];
  const q = (Array.isArray(nj.rotation) ? nj.rotation : [0, 0, 0, 1]) as number[];
  const s = (Array.isArray(nj.scale) ? nj.scale : [1, 1, 1]) as number[];
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function grow(b: Bounds | undefined, p: Vec3): Bounds {
  if (!b) return { min: [...p] as Vec3, max: [...p] as Vec3 };
  for (let i = 0; i < 3; i++) { if (p[i] < b.min[i]) b.min[i] = p[i]; if (p[i] > b.max[i]) b.max[i] = p[i]; }
  return b;
}

export function unionBounds(list: Array<Bounds | undefined>): Bounds | undefined {
  let out: Bounds | undefined;
  for (const b of list) if (b) { out = grow(out, b.min); out = grow(out, b.max); }
  return out;
}

export function centreOf(b: Bounds): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Part name → world-space bounds of its whole subtree. Pure; tolerant. */
export function partBoundsOf(gltf: Record<string, unknown>): Map<string, Bounds> {
  const nodesJ = Array.isArray(gltf.nodes) ? gltf.nodes as Array<Record<string, unknown>> : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes as Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }> : [];
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors as Array<{ min?: number[]; max?: number[] }> : [];
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes as Array<{ nodes?: number[] }> : [];
  const sceneIx = typeof gltf.scene === 'number' ? gltf.scene : 0;
  const rootIx: number[] = scenes[sceneIx]?.nodes ?? scenes[0]?.nodes ?? nodesJ.map((_, i) => i);

  const out = new Map<string, Bounds>();
  const seen = new Set<number>();

  const meshBox = (mi: number, world: Mat4): Bounds | undefined => {
    let b: Bounds | undefined;
    for (const prim of meshes[mi]?.primitives ?? []) {
      const acc = accessors[prim.attributes?.POSITION ?? -1];
      if (!acc?.min || !acc?.max || acc.min.length < 3 || acc.max.length < 3) continue;
      for (let k = 0; k < 8; k++) {
        const c: Vec3 = [k & 1 ? acc.max[0] : acc.min[0], k & 2 ? acc.max[1] : acc.min[1], k & 4 ? acc.max[2] : acc.min[2]];
        b = grow(b, apply(world, c));
      }
    }
    return b;
  };

  const walk = (i: number, parentWorld: Mat4): Bounds | undefined => {
    if (seen.has(i) || i < 0 || i >= nodesJ.length) return undefined;
    seen.add(i);
    const nj = nodesJ[i];
    const world = mul(parentWorld, localMatrix(nj));
    let b = typeof nj.mesh === 'number' ? meshBox(nj.mesh, world) : undefined;
    for (const k of (Array.isArray(nj.children) ? nj.children as number[] : [])) b = unionBounds([b, walk(k, world)]);
    const name = typeof nj.name === 'string' && nj.name.trim() ? nj.name : `node${i}`;
    if (b) out.set(name, b);
    return b;
  };
  for (const r of rootIx) walk(r, I4);
  for (let i = 0; i < nodesJ.length; i++) if (!seen.has(i)) walk(i, I4);
  return out;
}

export function partBoundsFromGlb(buf: Buffer): Map<string, Bounds> {
  return partBoundsOf(readGlbJson(buf));
}
