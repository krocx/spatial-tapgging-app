// assembly-model.js - one way to read an assembly GLB in the browser
// (2026.4.50, backlog #7 slice 2). Used by the XR kit, the Models page
// preview and the Designer's Studio so the three never disagree on what a
// part is called, which parts rest hidden, and which nodes are playback
// frames rather than parts. Three.js is injected; no DOM here.
//
// Proprietary & Confidential · Applied Materials.

/** Baked hose flipbook frames (`<owner>#s<n>f<k>`) and the owner's rest tube (`<owner>#rest`). */
export const isFrameNode = name => /#s\d+f\d+$/.test(String(name || ''));
export const isPlaybackNode = name => /#(s\d+f\d+|rest)$/.test(String(name || ''));

/**
 * Restore the glTF node names GLTFLoader sanitised (it strips ':' '.' '/'
 * '[' ']', so `cmp:PN_0190-1` would come out as `cmpPN_0190-1`). Part
 * control is by name, so the original names come back from the parser's
 * associations, falling back to the exporter's extras.def.
 */
export function restoreNames(gltf) {
  const root = gltf.scene;
  const gltfNodes = gltf.parser?.json?.nodes || [];
  root.traverse(o => {
    const idx = gltf.parser?.associations?.get(o)?.nodes;
    const orig = idx !== undefined ? gltfNodes[idx]?.name : undefined;
    if (orig) o.name = orig;
    else if (o.userData?.def && !String(o.name).startsWith('cmp:')) o.name = `cmp:${o.userData.def}`;
  });
  return root;
}

/** True when the publication starts this node hidden (extras.visible=false on it or an ancestor below `root`). */
export function startsHidden(o, root) {
  for (let q = o; q && q !== root; q = q.parent) if (q.userData?.visible === false) return true;
  return false;
}

/**
 * Prepare the meshes for a player: own materials per mesh (so a part's
 * opacity never leaks), flat shading for CAD edges, normals when the writer
 * left them out, and the rest visibility (hidden0) from the model itself.
 * `frames: 'hide'` leaves playback frames out (library preview);
 * 'keep' leaves them for the player's deltas (XR kit).
 */
export function prepareMeshes(root, THREE, { frames = 'keep' } = {}) {
  let hiddenFrames = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.transparent = true; c.flatShading = true; c.side = THREE.DoubleSide; c.needsUpdate = true; return c; });
    o.material = Array.isArray(o.material) ? mats : mats[0];
    o.userData.mats = mats;
    o.userData.hidden0 = startsHidden(o, root);
    if (o.userData.hidden0) for (const m of mats) { m.opacity = 0; m.visible = false; }
  });
  if (frames === 'hide') root.traverse(o => { if (isFrameNode(o.userData?.name || o.name)) { o.visible = false; hiddenFrames++; } });
  return { hiddenFrames };
}

/**
 * The parts map: node name → { obj, rest, insts, meshes, depth, centerLocal,
 * displayName }. A re-used part (VRML USE) is several nodes with one name,
 * so state and playback address every instance. `refs` (step and initial
 * nodes) lets a part the model renamed since the guide was written be found
 * by objectID (the step's sourceKey) - the server's Rebind parts makes that
 * permanent; here it just keeps the step working.
 */
export function buildParts(root, THREE, refs = []) {
  const parts = new Map();
  const depthOf = o => { let d = 0, c = o; while (c && c !== root) { d++; c = c.parent; } return d; };
  root.traverse(o => {
    if (typeof o.name !== 'string' || !o.name.startsWith('cmp:')) return;
    const meshes = []; o.traverse(m => { if (m.isMesh) meshes.push(m); });
    const bb = new THREE.Box3().setFromObject(o); const center = bb.isEmpty() ? new THREE.Vector3() : bb.getCenter(new THREE.Vector3());
    o.updateMatrixWorld();
    const inst = { obj: o, rest: { pos: o.position.clone(), quat: o.quaternion.clone() } };
    const prev = parts.get(o.name);
    if (prev) { prev.insts.push(inst); prev.meshes.push(...meshes); return; }
    parts.set(o.name, { obj: o, rest: inst.rest, insts: [inst], meshes, depth: depthOf(o), centerLocal: o.parent ? o.parent.worldToLocal(center.clone()) : center, displayName: o.userData?.displayName || o.userData?.def || o.name.slice(4) });
  });
  const duplicates = [...parts.values()].filter(p => p.insts.length > 1).length;
  const byOid = new Map();
  for (const [name, p] of parts) { const oid = p.obj.userData?.objectID; if (oid !== undefined && oid !== null) byOid.set(String(oid), byOid.has(String(oid)) ? null : name); }
  let aliased = 0;
  for (const d of refs) if (!parts.has(d.node) && d.sourceKey && /^\d+$/.test(d.sourceKey)) { const name = byOid.get(d.sourceKey); if (name) { parts.set(d.node, parts.get(name)); aliased++; } }
  const referenced = new Set(refs.map(d => d.node));
  const missing = [...referenced].filter(n => !parts.has(n));
  return { parts, duplicates, aliased, referenced, missing };
}
