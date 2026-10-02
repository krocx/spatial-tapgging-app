// colour.ts - colour for assemblies that export in grey.
//
// Some publications leave every part the same grey, and a grey O-ring on a
// grey housing is hard to find on a headset. SIB can colour the model itself
// so the app, the XR kit and the Designer all show the same thing:
//
//   analyse  - is the model greyscale (no textures, every base colour with
//              next to no saturation)? which parts, grouped into families by
//              name (BOLT_M6_01 and BOLT_M6_02 are one family)?
//   suggest  - a stable palette per family: fasteners stay a light neutral,
//              seals / hoses / gaskets take the accent, everything else a
//              muted industrial colour chosen from the family name, so the
//              same deck colours the same way on every server.
//   apply    - rewrite the GLB's JSON chunk: each coloured part gets its own
//              material (and its own mesh entry when the mesh is shared), so
//              neighbours never change colour together. The BIN chunk is
//              untouched; variants are rebuilt by the caller.
//
// The original GLB is kept beside the coloured one (<id>.orig.glb) so Reset
// is exact. Textures are out of scope: a textured model is never greyscale
// here and apply() drops the texture only on the parts it recolours.
// Proprietary & Confidential · Applied Materials.

import { readGlbJson, isPlaybackNode } from './glb-nodes.js';

export type RGB = [number, number, number];
export interface PartColour { name: string; family: string; current: RGB | null; suggested: RGB; kind: 'fastener' | 'seal' | 'body' }
export interface ColourAnalysis { greyscale: boolean; textured: boolean; parts: PartColour[]; families: Array<{ family: string; kind: PartColour['kind']; parts: number; suggested: RGB }>; materials: number; greyMaterials: number }

type Node = { name?: string; mesh?: number; children?: number[] };
type Prim = { material?: number; attributes?: Record<string, number> };
type Mesh = { name?: string; primitives: Prim[] };
type Material = { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown; metallicFactor?: number; roughnessFactor?: number }; emissiveFactor?: number[] };
type Gltf = { nodes?: Node[]; meshes?: Mesh[]; materials?: Material[]; textures?: unknown[] };

const isPart = (n: Node): boolean => typeof n.name === 'string' && n.name.startsWith('cmp:') && !isPlaybackNode(n.name);

/** BOLT_M6_01 → bolt_m6 · O_RING.2 → o_ring · HOUSING → housing */
export function familyOf(partName: string): string {
  let s = partName.replace(/^cmp:/, '').toLowerCase().replace(/\s*\(\d+\)$/, '');
  // Instance counters sit behind a separator: _01, .2, -3. A digit glued to a
  // word (m6, housing2) is part of the name.
  for (let i = 0; i < 3; i++) s = s.replace(/[\s_\-.]+\d+$/, '');
  return s.replace(/[\s\-.]+/g, '_').replace(/^_+|_+$/g, '') || partName.toLowerCase();
}
export function kindOf(family: string): PartColour['kind'] {
  if (/(^|_)(bolt|nut|screw|washer|rivet|pin|stud|fastener|clip|circlip|spring)(_|$)/.test(family)) return 'fastener';
  if (/(^|_)(o_?ring|oring|seal|gasket|hose|tube|pipe|belt|cable|wire|ring)(_|$)/.test(family)) return 'seal';
  return 'body';
}

/** Muted industrial palette (sRGB 0..1). Order matters: hashing picks from it. */
export const PALETTE: RGB[] = [
  [0.29, 0.56, 0.75], // steel blue
  [0.36, 0.62, 0.55], // teal green
  [0.70, 0.55, 0.30], // brass
  [0.55, 0.45, 0.65], // plum
  [0.45, 0.60, 0.35], // olive
  [0.72, 0.42, 0.35], // brick
  [0.40, 0.50, 0.68], // slate blue
  [0.62, 0.60, 0.42], // sand
  [0.33, 0.62, 0.66], // cyan grey
  [0.66, 0.50, 0.55], // mauve
  [0.50, 0.66, 0.70], // sky
  [0.60, 0.62, 0.33], // moss
];
export const FASTENER: RGB = [0.78, 0.78, 0.80];
export const SEAL: RGB = [0.95, 0.55, 0.15];

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
export function suggestFor(family: string): RGB {
  const k = kindOf(family);
  if (k === 'fastener') return FASTENER;
  if (k === 'seal') return SEAL;
  return PALETTE[hash(family) % PALETTE.length];
}

const sat = (c: number[]): number => { const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return mx === 0 ? 0 : (mx - mn) / mx; };

/** Meshes under a part node (its subtree, stopping at child parts, which have their own colour). */
function meshesUnder(g: Gltf, idx: number, acc: number[], root: boolean): void {
  const n = g.nodes![idx];
  if (!root && isPart(n)) return;
  if (typeof n.mesh === 'number') acc.push(n.mesh);
  for (const c of n.children ?? []) meshesUnder(g, c, acc, false);
}

export function analyseColours(glb: Buffer): ColourAnalysis {
  const g = readGlbJson(glb) as Gltf;
  const mats = g.materials ?? [];
  const greyMaterials = mats.filter(m => !m.pbrMetallicRoughness?.baseColorTexture && sat(m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]) < 0.12).length;
  const textured = mats.some(m => !!m.pbrMetallicRoughness?.baseColorTexture);
  const greyscale = mats.length > 0 && !textured && greyMaterials / mats.length >= 0.9;
  const parts: PartColour[] = [];
  (g.nodes ?? []).forEach((n, i) => {
    if (!isPart(n)) return;
    const meshes: number[] = []; meshesUnder(g, i, meshes, true);
    let current: RGB | null = null;
    for (const mi of meshes) for (const p of g.meshes?.[mi]?.primitives ?? []) {
      const m = typeof p.material === 'number' ? mats[p.material] : undefined;
      const f = m?.pbrMetallicRoughness?.baseColorFactor; if (f && !current) current = [f[0], f[1], f[2]];
    }
    const family = familyOf(n.name!);
    parts.push({ name: n.name!, family, current, suggested: suggestFor(family), kind: kindOf(family) });
  });
  const fam = new Map<string, { family: string; kind: PartColour['kind']; parts: number; suggested: RGB }>();
  for (const p of parts) { const f = fam.get(p.family); if (f) f.parts++; else fam.set(p.family, { family: p.family, kind: p.kind, parts: 1, suggested: p.suggested }); }
  return { greyscale, textured, parts, families: [...fam.values()].sort((a, b) => b.parts - a.parts || a.family.localeCompare(b.family)), materials: mats.length, greyMaterials };
}

/** Colour map from the analysis: per part, the family's colour (overrides by family name win). */
export function autoMap(a: ColourAnalysis, overrides: Record<string, RGB> = {}): Record<string, RGB> {
  const out: Record<string, RGB> = {};
  for (const p of a.parts) out[p.name] = overrides[p.family] ?? p.suggested;
  return out;
}

export interface ApplyResult { glb: Buffer; recoloured: number; materialsAdded: number; meshesCloned: number }

/** Rewrite materials so every part in `map` shows its colour. JSON chunk only. */
export function applyColours(glb: Buffer, map: Record<string, RGB>): ApplyResult {
  const g = readGlbJson(glb) as Gltf;
  g.materials = g.materials ?? []; g.meshes = g.meshes ?? []; g.nodes = g.nodes ?? [];
  // How many part nodes reference each mesh: shared meshes are cloned before recolouring.
  const users = new Map<number, number>();
  g.nodes.forEach((n, i) => { if (!isPart(n)) return; const ms: number[] = []; meshesUnder(g, i, ms, true); for (const m of ms) users.set(m, (users.get(m) ?? 0) + 1); });
  const matCache = new Map<string, number>();
  const materialFor = (src: number | undefined, rgb: RGB): number => {
    const key = `${src ?? -1}:${rgb.map(v => v.toFixed(3)).join(',')}`;
    const hit = matCache.get(key); if (hit !== undefined) return hit;
    const base: Material = src !== undefined && g.materials![src] ? JSON.parse(JSON.stringify(g.materials![src])) as Material : { pbrMetallicRoughness: { metallicFactor: 0.2, roughnessFactor: 0.7 } };
    base.pbrMetallicRoughness = base.pbrMetallicRoughness ?? {};
    const a = base.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1;
    base.pbrMetallicRoughness.baseColorFactor = [rgb[0], rgb[1], rgb[2], a];
    delete base.pbrMetallicRoughness.baseColorTexture;
    base.name = `${base.name ?? 'material'} · sib-colour`;
    g.materials!.push(base); const idx = g.materials!.length - 1; matCache.set(key, idx); return idx;
  };
  let recoloured = 0, meshesCloned = 0; const materialsBefore = g.materials.length;
  // The first part to recolour a shared mesh keeps it; the next ones get a clone.
  const claimed = new Set<number>();
  const recolourNode = (idx: number, rgb: RGB, root: boolean) => {
    const n = g.nodes![idx];
    if (!root && isPart(n)) return;
    if (typeof n.mesh === 'number') {
      let mi = n.mesh;
      if ((users.get(mi) ?? 0) > 1 && claimed.has(mi)) { g.meshes!.push(JSON.parse(JSON.stringify(g.meshes![mi])) as Mesh); mi = g.meshes!.length - 1; n.mesh = mi; meshesCloned++; }
      claimed.add(n.mesh);
      for (const p of g.meshes![mi].primitives) p.material = materialFor(p.material, rgb);
    }
    for (const c of n.children ?? []) recolourNode(c, rgb, false);
  };
  g.nodes.forEach((n, i) => { if (!isPart(n)) return; const rgb = map[n.name!]; if (!rgb) return; recolourNode(i, rgb, true); recoloured++; });
  return { glb: recoloured ? rewriteJson(glb, g) : glb, recoloured, materialsAdded: g.materials.length - materialsBefore, meshesCloned };
}

/** Same BIN chunk, new JSON chunk (as assembled-pose.ts). */
export function rewriteJson(glb: Buffer, json: unknown): Buffer {
  const jsonLen = glb.readUInt32LE(12);
  const rest = glb.subarray(20 + jsonLen);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const out = Buffer.concat([header, jh, js, rest]);
  out.writeUInt32LE(out.length, 8);
  return out;
}

/** Build a GLB from JSON and a BIN chunk - the tests and the importer's fixtures. */
export function makeGlb(json: unknown, bin: Buffer = Buffer.alloc(0)): Buffer {
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const pad = (4 - (js.length % 4)) % 4; if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  let bb = bin; const bpad = (4 - (bb.length % 4)) % 4; if (bpad) bb = Buffer.concat([bb, Buffer.alloc(bpad, 0)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, js, bh, bb]); out.writeUInt32LE(out.length, 8); return out;
}
