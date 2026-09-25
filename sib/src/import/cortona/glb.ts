// glb.ts - minimal glTF 2.0 binary writer for the imported assembly.
//
// One GLB, node hierarchy preserved, node names = `cmp:<DEF>` so guide steps
// can address parts by name (CAD-CONTENT.md §2). Every node carries `extras`
// with the source DEF, display name, objectID (when known from the procedure)
// and part number / description (when known from DocItems). Meshes are
// positions + indices only - glTF clients compute flat normals when NORMAL is
// absent - with a baseColorFactor material per distinct colour/alpha.
//
// Hidden-at-rest nodes (Switch choice not selected, ObjectVM whichChoice -1)
// are still emitted; `extras.visible=false` records the initial state so the
// runtime can honour it. Units are metres; axis convention is whatever the
// publisher wrote (Y-up per both reconnaissance reports).

import type { SceneGraph, SceneNode, SceneMesh } from './scene.js';
import { isIdentity } from './scene.js';

export interface NodeExtras {
  objectID?:    number;
  partNumber?:  string;
  description?: string;
}

export function writeGlb(scene: SceneGraph, extrasByDef: Map<string, NodeExtras> = new Map()): Buffer {
  const bin: Buffer[] = []; let binLen = 0;
  const bufferViews: unknown[] = []; const accessors: unknown[] = [];
  const meshes: unknown[] = []; const materials: unknown[] = []; const nodes: unknown[] = [];
  const meshIndex = new Map<SceneMesh, number>(); const matIndex = new Map<string, number>();

  const pushView = (data: Buffer, target?: number): number => {
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
    const idx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: data.length, ...(target ? { target } : {}) });
    bin.push(data); binLen += data.length;
    return idx;
  };

  const material = (m: SceneMesh): number => {
    const alpha = Math.max(0, Math.min(1, 1 - m.transparency));
    const key = `${m.color.map(c => c.toFixed(3)).join(',')}|${alpha.toFixed(3)}`;
    let i = matIndex.get(key);
    if (i === undefined) {
      i = materials.length;
      materials.push({
        pbrMetallicRoughness: { baseColorFactor: [m.color[0], m.color[1], m.color[2], alpha], metallicFactor: 0.1, roughnessFactor: 0.8 },
        doubleSided: true,
        ...(alpha < 1 ? { alphaMode: 'BLEND' } : {}),
      });
      matIndex.set(key, i);
    }
    return i;
  };

  const mesh = (m: SceneMesh): number => {
    let i = meshIndex.get(m); if (i !== undefined) return i;
    const pos = Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength);
    const posView = pushView(pos, 34962);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.positions.length; k += 3) for (let a = 0; a < 3; a++) {
      const v = m.positions[k + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v;
    }
    const posAcc = accessors.length;
    accessors.push({ bufferView: posView, componentType: 5126, count: m.positions.length / 3, type: 'VEC3', min, max });
    const idx = Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
    const idxView = pushView(idx, 34963);
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxView, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    i = meshes.length;
    meshes.push({ primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, material: material(m), mode: 4 }] });
    meshIndex.set(m, i);
    return i;
  };

  const emit = (n: SceneNode): number => {
    const idx = nodes.length;
    const node: Record<string, unknown> = { name: n.def ? `cmp:${n.def}` : n.id };
    nodes.push(node); // reserve index before children
    if (!isIdentity(n.matrix)) node.matrix = n.matrix;
    const extras: Record<string, unknown> = { type: n.type };
    if (n.def) extras.def = n.def;
    if (n.name) extras.displayName = n.name;
    if (!n.visible) extras.visible = false;
    const ex = n.def ? extrasByDef.get(n.def) : undefined;
    if (ex) Object.assign(extras, ex);
    node.extras = extras;
    const children: number[] = [];
    if (n.meshes.length === 1 && n.children.length === 0) {
      node.mesh = mesh(n.meshes[0]);
    } else {
      for (const m of n.meshes) { const ci = nodes.length; nodes.push({ name: `${node.name as string}#mesh`, mesh: mesh(m) }); children.push(ci); }
    }
    for (const c of n.children) children.push(emit(c));
    if (children.length) node.children = children;
    return idx;
  };

  const rootIds = scene.roots.map(emit);
  const json = {
    asset: { version: '2.0', generator: 'SIB cortona-import' },
    scene: 0,
    scenes: [{ nodes: rootIds }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: binLen + ((4 - (binLen % 4)) % 4) }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4; if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  let binBuf = Buffer.concat(bin);
  const bpad = (4 - (binBuf.length % 4)) % 4; if (bpad) binBuf = Buffer.concat([binBuf, Buffer.alloc(bpad)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jChunk = Buffer.alloc(8); jChunk.writeUInt32LE(jsonBuf.length, 0); jChunk.writeUInt32LE(0x4E4F534A, 4);
  const bChunk = Buffer.alloc(8); bChunk.writeUInt32LE(binBuf.length, 0); bChunk.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jChunk, jsonBuf, bChunk, binBuf]);
}
