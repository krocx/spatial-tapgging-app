// glb-merge.ts - many GLBs → one assembly GLB, each placement a named node.
//
// A `.guide` places assets in the anchor frame; SIB shows a guide's parts
// as one assembly model with per-step node deltas. So every placement
// becomes a node named `pl:<placementGuid>` under the root, carrying the
// converted TRS, whose child is the asset's own scene (its nodes, meshes,
// materials, textures, images, skins, animations, copied once per asset
// and instanced per placement - meshes and materials are shared across
// placements of the same asset; node subtrees are duplicated because glTF
// nodes have a single parent).
//
// Material fixes while copying: KHR_materials_pbrSpecularGlossiness is
// folded to metallic-roughness (diffuse → baseColor, roughness = 1 -
// glossiness, metallic 0) because many USDZ converters ignore it; a
// primitive with no material gets a neutral default. Both are counted.
//
// Buffers: one BIN; every bufferView's byteOffset is shifted; accessors keep
// their bufferView index after renumbering. Animations are copied per asset
// instance with their channels re-targeted at the instanced node ids.
//
// Proprietary & Confidential · Applied Materials.

export interface MergeNodeSpec {
  /** Node name, e.g. `pl:<guid>`. */
  name:        string;
  assetKey:    string;                 // which GLB (dedupe key, e.g. the asset GUID)
  translation?: [number, number, number];
  rotation?:    [number, number, number, number];
  scale?:       [number, number, number];
  /** Extra per-node metadata written to node.extras. */
  extras?:      Record<string, unknown>;
}
export interface MergeStats { assets: number; instances: number; meshes: number; materials: number; textures: number; animations: number; specGlossFolded: number; defaultMaterials: number; triangles: number; warnings: string[] }
export interface MergeResult { glb: Buffer; stats: MergeStats; bounds?: { min: [number, number, number]; max: [number, number, number] } }

type J = Record<string, any>;

interface ParsedGlb { json: J; bin: Buffer }

export function parseGlb(bytes: Buffer): ParsedGlb {
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const version = bytes.readUInt32LE(4); if (version !== 2) throw new Error(`GLB version ${version} is not supported`);
  const total = bytes.readUInt32LE(8); if (total > bytes.length) throw new Error('GLB length field exceeds the data');
  let off = 12; let json: J | null = null; let bin: Buffer = Buffer.alloc(0);
  while (off + 8 <= total) {
    const len = bytes.readUInt32LE(off), type = bytes.readUInt32LE(off + 4); off += 8;
    if (off + len > total) throw new Error('GLB chunk runs past the end');
    const chunk = bytes.subarray(off, off + len); off += len;
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function writeGlb(json: J, bin: Buffer): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4, bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBuf.length + jpad + (bin.length ? 8 + bin.length + bpad : 0);
  const out = Buffer.alloc(total);
  out.write('glTF', 0, 'latin1'); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let off = 12;
  out.writeUInt32LE(jsonBuf.length + jpad, off); out.writeUInt32LE(0x4e4f534a, off + 4); off += 8;
  jsonBuf.copy(out, off); off += jsonBuf.length; for (let i = 0; i < jpad; i++) out[off++] = 0x20;
  if (bin.length) { out.writeUInt32LE(bin.length + bpad, off); out.writeUInt32LE(0x004e4942, off + 4); off += 8; bin.copy(out, off); off += bin.length; for (let i = 0; i < bpad; i++) out[off++] = 0; }
  return out;
}

const DEFAULT_MATERIAL: J = { name: 'sib-default', pbrMetallicRoughness: { baseColorFactor: [0.72, 0.72, 0.74, 1], metallicFactor: 0.1, roughnessFactor: 0.7 } };

/** Fold KHR_materials_pbrSpecularGlossiness into pbrMetallicRoughness (returns true when it did). */
function foldSpecGloss(m: J): boolean {
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness; if (!sg) return false;
  const pbr: J = m.pbrMetallicRoughness ?? {};
  if (sg.diffuseFactor) pbr.baseColorFactor = sg.diffuseFactor;
  if (sg.diffuseTexture) pbr.baseColorTexture = sg.diffuseTexture;
  const gloss = typeof sg.glossinessFactor === 'number' ? sg.glossinessFactor : 1;
  pbr.metallicFactor = 0; pbr.roughnessFactor = Math.max(0, Math.min(1, 1 - gloss));
  m.pbrMetallicRoughness = pbr;
  delete m.extensions.KHR_materials_pbrSpecularGlossiness;
  if (!Object.keys(m.extensions).length) delete m.extensions;
  return true;
}

/** Merge. `glbs` maps assetKey → GLB bytes; every node spec instances one of them. */
export function mergeGlbs(glbs: Map<string, Buffer>, nodes: MergeNodeSpec[], opts: { rootName?: string } = {}): MergeResult {
  const out: J = { asset: { version: '2.0', generator: 'SIB dynamics-guides importer' }, scene: 0, scenes: [{ name: opts.rootName ?? 'guide', nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], textures: [], images: [], samplers: [], skins: [], animations: [], extensionsUsed: [] };
  const stats: MergeStats = { assets: 0, instances: 0, meshes: 0, materials: 0, textures: 0, animations: 0, specGlossFolded: 0, defaultMaterials: 0, triangles: 0, warnings: [] };
  const binParts: Buffer[] = []; let binLen = 0;
  const usedExt = new Set<string>();

  // Per asset: shared index maps for things safe to share (buffers, views, accessors, materials, meshes, textures, images, samplers).
  interface AssetTables { json: J; bvBase: number; accBase: number; matBase: number; meshBase: number; texBase: number; imgBase: number; smpBase: number; defaultMat?: number; sceneRoots: number[] }
  const tables = new Map<string, AssetTables>();

  const prepareAsset = (key: string): AssetTables | null => {
    const existing = tables.get(key); if (existing) return existing;
    const bytes = glbs.get(key); if (!bytes) { stats.warnings.push(`asset ${key.slice(0, 8)}: missing from the package - placement skipped`); return null; }
    let p: ParsedGlb; try { p = parseGlb(bytes); } catch (e) { stats.warnings.push(`asset ${key.slice(0, 8)}: ${(e as Error).message}`); return null; }
    const j = p.json;
    // Only single-buffer, embedded-BIN GLBs are supported (what Guides ships). External URIs are refused.
    if ((j.buffers ?? []).some((b: J) => b.uri)) { stats.warnings.push(`asset ${key.slice(0, 8)}: external buffer URIs are not supported - skipped`); return null; }
    if ((j.images ?? []).some((im: J) => im.uri)) { stats.warnings.push(`asset ${key.slice(0, 8)}: external image URIs are not supported - images dropped`); }
    const t: AssetTables = { json: j, bvBase: out.bufferViews.length, accBase: out.accessors.length, matBase: out.materials.length, meshBase: out.meshes.length, texBase: out.textures.length, imgBase: out.images.length, smpBase: out.samplers.length, sceneRoots: [] };
    // bin
    const pad = (4 - (binLen % 4)) % 4; if (pad) { binParts.push(Buffer.alloc(pad)); binLen += pad; }
    const base = binLen; binParts.push(p.bin); binLen += p.bin.length;
    for (const bv of j.bufferViews ?? []) out.bufferViews.push({ ...bv, buffer: 0, byteOffset: (bv.byteOffset ?? 0) + base });
    for (const a of j.accessors ?? []) out.accessors.push({ ...a, ...(a.bufferView !== undefined ? { bufferView: a.bufferView + t.bvBase } : {}), ...(a.sparse ? { sparse: { ...a.sparse, indices: { ...a.sparse.indices, bufferView: a.sparse.indices.bufferView + t.bvBase }, values: { ...a.sparse.values, bufferView: a.sparse.values.bufferView + t.bvBase } } } : {}) });
    for (const s of j.samplers ?? []) out.samplers.push({ ...s });
    for (const im of j.images ?? []) out.images.push(im.uri ? { name: im.name } : { ...im, bufferView: im.bufferView + t.bvBase });
    for (const tx of j.textures ?? []) out.textures.push({ ...tx, ...(tx.source !== undefined ? { source: tx.source + t.imgBase } : {}), ...(tx.sampler !== undefined ? { sampler: tx.sampler + t.smpBase } : {}) });
    const retex = (info: J | undefined) => info && typeof info.index === 'number' ? { ...info, index: info.index + t.texBase } : info;
    for (const m0 of j.materials ?? []) {
      const m: J = JSON.parse(JSON.stringify(m0));
      if (foldSpecGloss(m)) stats.specGlossFolded++;
      if (m.pbrMetallicRoughness) { m.pbrMetallicRoughness.baseColorTexture = retex(m.pbrMetallicRoughness.baseColorTexture); m.pbrMetallicRoughness.metallicRoughnessTexture = retex(m.pbrMetallicRoughness.metallicRoughnessTexture); }
      m.normalTexture = retex(m.normalTexture); m.occlusionTexture = retex(m.occlusionTexture); m.emissiveTexture = retex(m.emissiveTexture);
      for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
      out.materials.push(m);
    }
    for (const me of j.meshes ?? []) {
      const prims = (me.primitives ?? []).map((pr: J) => {
        const q: J = { ...pr, attributes: Object.fromEntries(Object.entries(pr.attributes ?? {}).map(([k, v]) => [k, (v as number) + t.accBase])) };
        if (pr.indices !== undefined) q.indices = pr.indices + t.accBase;
        if (pr.targets) q.targets = pr.targets.map((tg: J) => Object.fromEntries(Object.entries(tg).map(([k, v]) => [k, (v as number) + t.accBase])));
        if (pr.material !== undefined) q.material = pr.material + t.matBase;
        else { if (t.defaultMat === undefined) { t.defaultMat = out.materials.length; out.materials.push({ ...DEFAULT_MATERIAL }); } q.material = t.defaultMat; stats.defaultMaterials++; }
        // triangles for the stats
        const idx = pr.indices !== undefined ? j.accessors?.[pr.indices] : (pr.attributes?.POSITION !== undefined ? j.accessors?.[pr.attributes.POSITION] : null);
        if (idx && (pr.mode === undefined || pr.mode === 4)) stats.triangles += Math.floor((idx.count ?? 0) / 3);
        return q;
      });
      out.meshes.push({ ...me, primitives: prims });
    }
    for (const e of j.extensionsUsed ?? []) if (e !== 'KHR_materials_pbrSpecularGlossiness') usedExt.add(e);
    t.sceneRoots = (j.scenes?.[j.scene ?? 0]?.nodes ?? []) as number[];
    tables.set(key, t); stats.assets++;
    return t;
  };

  // Instance an asset's node subtree under a new parent node; returns the new root ids and the old→new node map.
  const instanceNodes = (t: AssetTables, prefix: string): { roots: number[]; map: Map<number, number> } => {
    const j = t.json; const map = new Map<number, number>();
    const copy = (oldId: number): number => {
      if (map.has(oldId)) return map.get(oldId)!;
      const n0: J = j.nodes?.[oldId] ?? {};
      const n: J = { ...n0 }; delete n.children; delete n.skin;
      if (n.mesh !== undefined) n.mesh = n.mesh + t.meshBase;
      n.name = n0.name ? `${prefix}/${n0.name}` : `${prefix}/node${oldId}`;
      const id = out.nodes.length; out.nodes.push(n); map.set(oldId, id);
      if (n0.children?.length) n.children = n0.children.map((c: number) => copy(c));
      return id;
    };
    const roots = t.sceneRoots.map(r => copy(r));
    // skins (joints are nodes - re-map per instance)
    for (const [oldId, newId] of map) {
      const n0 = j.nodes?.[oldId]; if (n0?.skin === undefined) continue;
      const sk = j.skins?.[n0.skin]; if (!sk) continue;
      out.skins.push({ ...sk, joints: (sk.joints ?? []).map((jt: number) => map.get(jt) ?? copy(jt)), ...(sk.skeleton !== undefined ? { skeleton: map.get(sk.skeleton) ?? copy(sk.skeleton) } : {}), ...(sk.inverseBindMatrices !== undefined ? { inverseBindMatrices: sk.inverseBindMatrices + t.accBase } : {}) });
      out.nodes[newId].skin = out.skins.length - 1;
    }
    // animations: copied per instance, channels re-targeted
    for (const an of j.animations ?? []) {
      const channels = (an.channels ?? []).filter((c: J) => c.target?.node !== undefined && map.has(c.target.node)).map((c: J) => ({ ...c, target: { ...c.target, node: map.get(c.target.node) } }));
      if (!channels.length) continue;
      out.animations.push({ name: an.name ? `${prefix}/${an.name}` : prefix, channels, samplers: (an.samplers ?? []).map((s: J) => ({ ...s, input: s.input + t.accBase, output: s.output + t.accBase })) });
      stats.animations++;
    }
    return { roots, map };
  };

  const rootId = out.nodes.length; out.nodes.push({ name: opts.rootName ?? 'guide', children: [] }); out.scenes[0].nodes.push(rootId);
  for (const spec of nodes) {
    const t = prepareAsset(spec.assetKey); if (!t) continue;
    const inst = instanceNodes(t, spec.name);
    const n: J = { name: spec.name, children: inst.roots };
    if (spec.translation) n.translation = spec.translation; if (spec.rotation) n.rotation = spec.rotation; if (spec.scale) n.scale = spec.scale;
    if (spec.extras) n.extras = spec.extras;
    const id = out.nodes.length; out.nodes.push(n); out.nodes[rootId].children.push(id);
    stats.instances++;
  }
  stats.meshes = out.meshes.length; stats.materials = out.materials.length; stats.textures = out.textures.length;
  out.extensionsUsed = [...usedExt]; if (!out.extensionsUsed.length) delete out.extensionsUsed;
  const bin = Buffer.concat(binParts, binLen);
  out.buffers = bin.length ? [{ byteLength: bin.length }] : [];
  for (const k of ['textures', 'images', 'samplers', 'skins', 'animations']) if (!out[k].length) delete out[k];
  if (!out.materials.length) delete out.materials;
  return { glb: writeGlb(out, bin), stats, bounds: boundsOf(out, bin) };
}

/** World-space bounds of every POSITION accessor placed by its node chain (TRS only, no skins). */
function boundsOf(json: J, bin: Buffer): { min: [number, number, number]; max: [number, number, number] } | undefined {
  if (!json.accessors?.length || !json.nodes?.length) return undefined;
  let min: [number, number, number] | null = null, max: [number, number, number] | null = null;
  const mul = (a: number[], b: number[]) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r; };
  const trs = (n: J): number[] => {
    if (n.matrix) { const m = n.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]]; }
    const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
    const [x, y, z, w] = q; const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy - wz) * s[1], 2 * (xz + wy) * s[2], t[0], 2 * (xy + wz) * s[0], (1 - 2 * (xx + zz)) * s[1], 2 * (yz - wx) * s[2], t[1], 2 * (xz - wy) * s[0], 2 * (yz + wx) * s[1], (1 - 2 * (xx + yy)) * s[2], t[2], 0, 0, 0, 1];
  };
  const apply = (m: number[], p: number[]) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  const visit = (id: number, parent: number[], depth: number) => {
    if (depth > 64) return;
    const n = json.nodes[id]; const m = mul(parent, trs(n));
    if (n.mesh !== undefined) for (const pr of json.meshes?.[n.mesh]?.primitives ?? []) {
      const acc = json.accessors[pr.attributes?.POSITION]; if (!acc || acc.bufferView === undefined || !acc.min || !acc.max) continue;
      for (const corner of [[acc.min[0], acc.min[1], acc.min[2]], [acc.max[0], acc.min[1], acc.min[2]], [acc.min[0], acc.max[1], acc.min[2]], [acc.min[0], acc.min[1], acc.max[2]], [acc.max[0], acc.max[1], acc.min[2]], [acc.max[0], acc.min[1], acc.max[2]], [acc.min[0], acc.max[1], acc.max[2]], [acc.max[0], acc.max[1], acc.max[2]]]) {
        const w = apply(m, corner);
        if (!min) { min = [w[0], w[1], w[2]]; max = [w[0], w[1], w[2]]; } else { for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], w[a]); max![a] = Math.max(max![a], w[a]); } }
      }
    }
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes?.[0]?.nodes ?? []) visit(r, I, 0);
  void bin;
  return min && max ? { min, max } : undefined;
}
