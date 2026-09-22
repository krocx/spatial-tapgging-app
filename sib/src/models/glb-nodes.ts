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
