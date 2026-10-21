// fixture.ts - build synthetic `.guide` packages for tests (AROMS-365).
//
// No real guide is ever used. A small declarative description becomes a tar
// with the exact entry naming, the OData field and annotation conventions,
// and the metadata JSON shapes the importer expects: random GUIDs,
// placeholder names, tiny generated GLBs (a triangle; variants with an
// animation clip, a spec/gloss material, no material) and tiny PNG / JPEG
// bytes. Also used by the CLI to produce a sample package.
//
// Proprietary & Confidential · Applied Materials.

import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { FV } from './body.js';
import { STEP_TEMPLATE, RESPONSE_ACTION, ANCHOR_TYPE, ATTENTION_ENDPOINT, OBJECT_STYLE, ANIMATION_MODE } from './enums.js';

export interface FxModel { id?: string; name?: string; variant?: 'triangle' | 'animated' | 'specgloss' | 'nomaterial' | 'corrupt'; formatSays?: string; omitBody?: boolean }
export interface FxImage { id?: string; kind?: 'png' | 'jpeg'; omitBody?: boolean }
export interface FxPlacement { id?: string; model: string; position?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number]; isPlaced?: boolean; style?: number | 'unknown'; styleLabel?: string; animated?: boolean; animationMode?: number; ghost?: boolean; interactable?: boolean; trigger?: { action: number; destinationStep?: string } }
export interface FxObject { id?: string; model?: string; index?: number; placements?: FxPlacement[]; trigger?: { action: number; activation?: number; destinationStep?: string } }
export interface FxResponse { text?: string; action: number | 'unknown'; step?: string }
export interface FxStep { id?: string; text?: string; type?: 'default' | 'question' | 'completion' | 'unknown'; previous?: string | null | 'dangling'; image?: string; video?: string; objects?: FxObject[]; responses?: FxResponse[]; attention?: { endpoint?: number; placement?: string; position?: [number, number, number]; isPlaced?: boolean }; actionUrl?: string }
export interface FxTask { id?: string; name?: string; previous?: string | null | 'dangling'; steps: FxStep[] }
export interface FxGuide {
  name?: string; id?: string; schemaVersion?: number;
  anchorType?: number | 'unknown'; anchorTypeLabel?: string; anchorObject?: string;
  tasks: FxTask[];
  models?: Record<string, FxModel>;
  images?: Record<string, FxImage>;
  videos?: string[];
  completion?: { text?: string; image?: string; objects?: FxObject[]; attention?: { placement?: string; position?: [number, number, number] } };
  /** Shuffle every child array so order comes only from the previous-links. */
  shuffle?: boolean;
  /** Drop these root arrays entirely (missing-key scenario). */
  dropArrays?: string[];
  /** Add an entry with an unknown kind. */
  unknownEntry?: boolean;
  /** Extra arbitrary root keys. */
  extraRootKeys?: number;
  omitManifest?: boolean;
  folder?: { parent?: string; hierarchy?: string[] };
  seed?: number;
}

export interface FxBuilt { tar: Buffer; ids: { guide: string; tasks: string[]; steps: Record<string, string>; placements: Record<string, string>; models: Record<string, string>; images: Record<string, string>; videos: Record<string, string> } }

// ── Tiny assets ──────────────────────────────────────────────────────────────

function glbFrom(json: Record<string, unknown>, bin: Buffer): Buffer {
  const jb = Buffer.from(JSON.stringify(json)); const jp = (4 - jb.length % 4) % 4, bp = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + jb.length + jp + (bin.length ? 8 + bin.length + bp : 0);
  const out = Buffer.alloc(total); out.write('glTF', 0, 'latin1'); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let o = 12; out.writeUInt32LE(jb.length + jp, o); out.writeUInt32LE(0x4e4f534a, o + 4); o += 8; jb.copy(out, o); o += jb.length; for (let i = 0; i < jp; i++) out[o++] = 0x20;
  if (bin.length) { out.writeUInt32LE(bin.length + bp, o); out.writeUInt32LE(0x004e4942, o + 4); o += 8; bin.copy(out, o); o += bin.length; }
  return out;
}

/** A triangle at the origin, 0.1 m. Variants: animated (translation clip), specgloss, nomaterial. */
export function tinyGlb(variant: FxModel['variant'] = 'triangle', name = 'Model'): Buffer {
  if (variant === 'corrupt') return Buffer.from('glTF\x02\x00\x00\x00broken');
  const pos = Buffer.alloc(36); [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.alloc(8); [0, 1, 2, 0].forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  const parts = [pos, idx]; let bin = Buffer.concat(parts);
  const bufferViews: unknown[] = [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }];
  const accessors: unknown[] = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.1, 0.1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }];
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'sib-fixture' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: `${name}-root`, mesh: 0 }],
    meshes: [{ name: `${name}-mesh`, primitives: [{ attributes: { POSITION: 0 }, indices: 1, ...(variant === 'nomaterial' ? {} : { material: 0 }) }] }],
    ...(variant === 'nomaterial' ? {} : variant === 'specgloss'
      ? { materials: [{ name: 'sg', extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseFactor: [0.8, 0.2, 0.2, 1], glossinessFactor: 0.9 } } }], extensionsUsed: ['KHR_materials_pbrSpecularGlossiness'] }
      : { materials: [{ name: 'mr', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.6, 0.9, 1] } }] }),
    bufferViews, accessors, buffers: [{ byteLength: 0 }],
  };
  if (variant === 'animated') {
    const times = Buffer.alloc(8); times.writeFloatLE(0, 0); times.writeFloatLE(1, 4);
    const vals = Buffer.alloc(24); [0, 0, 0, 0, 0.2, 0].forEach((v, i) => vals.writeFloatLE(v, i * 4));
    const pad = Buffer.alloc((4 - bin.length % 4) % 4);
    const tOff = bin.length + pad.length, vOff = tOff + 8;
    bin = Buffer.concat([bin, pad, times, vals]);
    bufferViews.push({ buffer: 0, byteOffset: tOff, byteLength: 8 }, { buffer: 0, byteOffset: vOff, byteLength: 24 });
    accessors.push({ bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' });
    json.animations = [{ name: 'Take 001', channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }] }];
  }
  (json.buffers as { byteLength: number }[])[0].byteLength = bin.length;
  return glbFrom(json, bin);
}

function crc32(buf: Buffer): number { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
/** A 2×2 PNG. */
export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** The smallest valid-looking JPEG header (SOI + EOI with a minimal APP0). Enough to sniff and store. */
export function tinyJpeg(): Buffer { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]); }
export function tinyMp4(): Buffer { const b = Buffer.alloc(24); b.writeUInt32BE(24, 0); b.write('ftypisom', 4, 'latin1'); return b; }

// ── Tar writer ───────────────────────────────────────────────────────────────

export function writeTar(entries: { name: string; bytes: Buffer; type?: string; linkname?: string; mode?: number }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name.slice(0, 100), 0, 'latin1'); h.write((e.mode ?? 0o644).toString(8).padStart(7, '0') + '\0', 100, 'latin1');
    h.write('0000000\0', 108, 'latin1'); h.write('0000000\0', 116, 'latin1');
    h.write(e.bytes.length.toString(8).padStart(11, '0') + '\0', 124, 'latin1'); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'latin1');
    h.write('        ', 148, 'latin1'); h.write(e.type ?? '0', 156, 'latin1'); if (e.linkname) h.write(e.linkname.slice(0, 100), 157, 'latin1');
    h.write('ustar\0', 257, 'latin1'); h.write('00', 263, 'latin1');
    let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
    blocks.push(h); if (e.bytes.length) { blocks.push(e.bytes); const pad = (512 - e.bytes.length % 512) % 512; if (pad) blocks.push(Buffer.alloc(pad)); }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

// ── The builder ──────────────────────────────────────────────────────────────

const etagOf = (v: number) => encodeURIComponent(`W/"${v}"`);
function shuffleIn<T>(a: T[], rnd: () => number): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function lcg(seed: number): () => number { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function buildGuidePackage(fx: FxGuide): FxBuilt {
  const rnd = lcg(fx.seed ?? 42);
  const guideId = fx.id ?? randomUUID();
  const modelIds: Record<string, string> = {}, imageIds: Record<string, string> = {}, videoIds: Record<string, string> = {};
  for (const [k, m] of Object.entries(fx.models ?? {})) modelIds[k] = m.id ?? randomUUID();
  for (const [k, im] of Object.entries(fx.images ?? {})) imageIds[k] = im.id ?? randomUUID();
  for (const v of fx.videos ?? []) videoIds[v] = randomUUID();
  const taskIds: string[] = []; const stepIds: Record<string, string> = {}; const placementIds: Record<string, string> = {};
  const tasks: Record<string, unknown>[] = [], steps: Record<string, unknown>[] = [], objs: Record<string, unknown>[] = [], pls: Record<string, unknown>[] = [], cobjs: Record<string, unknown>[] = [], cpls: Record<string, unknown>[] = [];
  let si = 0;
  // ids first, so previous-links and response targets can refer to any step by key
  fx.tasks.forEach((t, ti) => { taskIds[ti] = t.id ?? randomUUID(); t.steps.forEach(s => { const key = s.id ?? `s${++si}`; s.id = key; stepIds[key] = /^[0-9a-f-]{36}$/i.test(key) ? key : randomUUID(); }); });
  const allObjs = (list: FxObject[] | undefined) => { for (const o of list ?? []) for (const p of o.placements ?? []) { const key = p.id ?? `p${Object.keys(placementIds).length + 1}`; p.id = key; placementIds[key] = /^[0-9a-f-]{36}$/i.test(key) ? key : randomUUID(); } };
  for (const t of fx.tasks) for (const s of t.steps) allObjs(s.objects);
  allObjs(fx.completion?.objects);
  const refStep = (k: string | undefined | null) => k === undefined ? undefined : k === null ? null : (stepIds[k] ?? k);
  const attentionOf = (a: FxStep['attention'] | undefined, prefix: string) => a ? {
    [`${prefix}endpointtype`]: a.endpoint ?? (a.placement ? ATTENTION_ENDPOINT.ThreeDObject : ATTENTION_ENDPOINT.NoAttachment),
    [`${prefix}endpointtype${FV}`]: a.placement ? '3D Object' : 'No Attachment',
    [`_${prefix}3dobject_value`]: a.placement ? placementIds[a.placement] ?? null : null,
    [`${prefix}isplaced`]: a.isPlaced ?? true,
    ...(a.position ? { [`${prefix}positionx`]: a.position[0], [`${prefix}positiony`]: a.position[1], [`${prefix}positionz`]: a.position[2], [`${prefix}rotationx`]: 0, [`${prefix}rotationy`]: 0, [`${prefix}rotationz`]: 0, [`${prefix}rotationw`]: 1 } : {}),
  } : {};
  const objectRows = (list: FxObject[] | undefined, stepGuid: string | null, intoObjs: Record<string, unknown>[], intoPls: Record<string, unknown>[], objKey: string, plKey: string, plObjRef: string) => {
    (list ?? []).forEach((o, oi) => {
      const oid = o.id ?? randomUUID();
      intoObjs.push({ [objKey]: oid, _msmrw_guidestep_value: stepGuid, _msmrw_3dobject_value: o.model ? modelIds[o.model] ?? o.model : null, msmrw_index: o.index ?? oi,
        msmrw_guidestepobjecttriggeraction: o.trigger?.action ?? 937380000, msmrw_guidestepobjecttriggeractivation: o.trigger?.activation ?? 937380001, _msmrw_guidestepobjecttriggerdestination_value: o.trigger?.destinationStep ? refStep(o.trigger.destinationStep) : null });
      for (const p of o.placements ?? []) {
        const style = p.style === 'unknown' ? 937380099 : (p.style ?? OBJECT_STYLE.Original);
        intoPls.push({ [plKey]: placementIds[p.id!], [plObjRef]: oid, _msmrw_3dobject_value: modelIds[p.model] ?? p.model,
          msmrw_positionx: p.position?.[0] ?? 0, msmrw_positiony: p.position?.[1] ?? 0, msmrw_positionz: p.position?.[2] ?? 0,
          msmrw_rotationx: p.rotation?.[0] ?? 0, msmrw_rotationy: p.rotation?.[1] ?? 0, msmrw_rotationz: p.rotation?.[2] ?? 0, msmrw_rotationw: p.rotation?.[3] ?? 1,
          msmrw_scalex: p.scale?.[0] ?? 1, msmrw_scaley: p.scale?.[1] ?? 1, msmrw_scalez: p.scale?.[2] ?? 1,
          msmrw_isplaced: p.isPlaced ?? true, msmrw_isinteractable: p.interactable ?? false, msmrw_objectghostisenabled: p.ghost ?? false,
          msmrw_3dobjectstyle: style, [`msmrw_3dobjectstyle${FV}`]: p.styleLabel ?? (style === OBJECT_STYLE.XRay ? 'X-ray' : style === OBJECT_STYLE.Green ? 'Green' : style === OBJECT_STYLE.Original ? 'Original' : 'Mystery style'),
          msmrw_3dobjectisanimated: p.animated ?? false, msmrw_3dobjectanimationmode: p.animationMode ?? ANIMATION_MODE.Loop, [`msmrw_3dobjectanimationmode${FV}`]: 'Loop', msmrw_3dobjectanimationdirection: true, msmrw_3dobjectanimationspeed: 100, msmrw_3dobjectanimationtake: null,
          msmrw_triggeractivation: 937380001, msmrw_triggeraction: p.trigger?.action ?? 937380000, _msmrw_triggerdestination_value: p.trigger?.destinationStep ? refStep(p.trigger.destinationStep) : null });
      }
    });
  };
  fx.tasks.forEach((t, ti) => {
    const prev = t.previous === 'dangling' ? randomUUID() : t.previous === undefined ? (ti ? taskIds[ti - 1] : null) : t.previous === null ? null : taskIds[fx.tasks.findIndex(x => x.id === t.previous)] ?? t.previous;
    tasks.push({ msmrw_guidetaskid: taskIds[ti], msmrw_name: t.name ?? `Task ${String.fromCharCode(65 + ti)}`, _msmrw_previoustask_value: prev });
    t.steps.forEach((s, sj) => {
      const type = s.type === 'question' ? STEP_TEMPLATE.Question : s.type === 'completion' ? STEP_TEMPLATE.Completion : s.type === 'unknown' ? 937380077 : STEP_TEMPLATE.Default;
      const prevStep = s.previous === 'dangling' ? randomUUID() : s.previous === undefined ? (sj ? stepIds[t.steps[sj - 1].id!] : null) : s.previous === null ? null : refStep(s.previous);
      const row: Record<string, unknown> = { msmrw_guidestepid: stepIds[s.id!], msmrw_instructiontext: s.text ?? `Step ${sj + 1}`, _msmrw_task_value: taskIds[ti], _msmrw_previousstep_value: prevStep,
        msmrw_steptemplatetype: type, [`msmrw_steptemplatetype${FV}`]: s.type === 'unknown' ? 'Mystery' : (s.type ?? 'default').replace(/^\w/, c => c.toUpperCase()),
        _msmrw_image_value: s.image ? imageIds[s.image] ?? s.image : null, _msmrw_video_value: s.video ? videoIds[s.video] ?? s.video : null,
        msmrw_actiontype: 937380000, msmrw_actionurl: s.actionUrl ?? null, ...attentionOf(s.attention, 'msmrw_attentiondirector') };
      (s.responses ?? []).forEach((r, n) => { row[`msmrw_response${n + 1}text`] = r.text ?? `Response ${n + 1}`; row[`msmrw_response${n + 1}actiontype`] = r.action === 'unknown' ? 937380066 : r.action; row[`msmrw_response${n + 1}actiontype${FV}`] = r.action === RESPONSE_ACTION.GoToStep ? 'Go To Step' : r.action === RESPONSE_ACTION.GoToNextStep ? 'Go To Next Step' : 'No Action'; row[`_msmrw_response${n + 1}step_value`] = r.step ? refStep(r.step) : null; });
      steps.push(row);
      objectRows(s.objects, stepIds[s.id!], objs, pls, 'msmrw_guidestepobjectid', 'msmrw_guidestepobjectplacementid', '_msmrw_guidestepobject_value');
    });
  });
  objectRows(fx.completion?.objects, null, cobjs, cpls, 'msmrw_guidecompletionstepobjectid', 'msmrw_guidecompletionstepobjectplacementid', '_msmrw_guidecompletionstepobject_value');

  const anchorType = fx.anchorType === 'unknown' ? 937380055 : (fx.anchorType ?? ANCHOR_TYPE.Holographic);
  const body: Record<string, unknown> = {
    '@odata.context': `https://example.crm.dynamics.com/api/data/v9.2/$metadata#msmrw_guides(msmrw_guideid,msmrw_name)/$entity`, '@odata.etag': 'W/"1001"',
    msmrw_guideid: guideId, msmrw_name: fx.name ?? 'Fixture guide', msmrw_integrationkey: null, msmrw_schemaversion: fx.schemaVersion ?? 5,
    msmrw_anchortype: anchorType, [`msmrw_anchortype${FV}`]: fx.anchorTypeLabel ?? (fx.anchorType === 'unknown' ? 'Mystery anchor' : 'Holographic'),
    _msmrw_anchor3dobject_value: fx.anchorObject ? modelIds[fx.anchorObject] ?? null : null, msmrw_anchor3dobjectstyle: OBJECT_STYLE.Original, msmrw_anchorstepinstructiontext: fx.anchorObject ? 'Align the hologram' : null,
    _msmrw_anchorstepimage_value: null, _msmrw_anchorstepvideo_value: null, _msdyn_anchorobjectanchor_value: null,
    msmrw_completioninstructiontext: fx.completion?.text ?? null, _msmrw_completionimage_value: fx.completion?.image ? imageIds[fx.completion.image] ?? null : null, _msmrw_completionvideo_value: null,
    ...attentionOf(fx.completion?.attention, 'msmrw_completionattentiondirector'),
    msmrw_GuideTask_Guide_msmrw_guide: fx.shuffle ? shuffleIn(tasks, rnd) : tasks,
    msmrw_GuideStep_Guide_msmrw_guide: fx.shuffle ? shuffleIn(steps, rnd) : steps,
    msmrw_msmrw_guide_msmrw_guidestepobject_Guide: fx.shuffle ? shuffleIn(objs, rnd) : objs,
    msmrw_msmrw_guide_msmrw_guidestepobjectplacement_Guide: fx.shuffle ? shuffleIn(pls, rnd) : pls,
    msmrw_msmrw_guide_msmrw_guidecompletionstepobject_Guide: cobjs,
    msmrw_msmrw_guide_msmrw_guidecompletionstepobjectplacement_Guide: cpls,
  };
  for (const k of fx.dropArrays ?? []) delete body[k];
  for (let i = 0; i < (fx.extraRootKeys ?? 0); i++) body[`msmrw_future${i}`] = i;

  const entries: { name: string; bytes: Buffer }[] = [];
  if (!fx.omitManifest) entries.push({ name: 'Guide_Manifest', bytes: Buffer.from(JSON.stringify({ PackagedGuideId: randomUUID(), GuideSolutionVersion: '900.1.2.3', GuideUri: `https://example.crm.dynamics.com/api/data/v9.2/msmrw_guides(${guideId})`, GuideId: guideId, GuideName: fx.name ?? 'Fixture guide' })) });
  entries.push({ name: 'Guide_Body', bytes: Buffer.from(JSON.stringify(body)) });
  entries.push({ name: 'Metadata_00000000-0000-0000-0000-000000000000', bytes: Buffer.from(JSON.stringify({ CreatedTime: '2026-01-01T00:00:00Z', UpdatedTime: '2026-06-01T00:00:00Z', Properties: { ParentFolderName: fx.folder?.parent ?? 'Fixtures', FolderHierarchy: JSON.stringify(fx.folder?.hierarchy ?? ['Root', 'Fixtures']) } })) });
  let v = 100;
  for (const [k, m] of Object.entries(fx.models ?? {})) {
    const id = modelIds[k]; const et = etagOf(++v);
    entries.push({ name: `Metadata_${id}`, bytes: Buffer.from(JSON.stringify({ DisplayName: m.name ?? `Model ${k}`, UpdatedMetadata: { Properties: { Format: m.formatSays ?? 'Glb', VertexCount: 3, MeshCount: 1, MaterialCount: m.variant === 'nomaterial' ? 0 : 1, TextureCount: 0, IndexCount: 3 }, ContentLinks: [`https://example.crm.dynamics.com/api/data/v9.2/msmrw_3dassets(${id})/msmrw_file`] }, ETag: `W/"${v}"`, VersionNumber: v })) });
    if (!m.omitBody) { entries.push({ name: `Model_Body_${id}_${et}`, bytes: tinyGlb(m.variant ?? 'triangle', m.name ?? `Model ${k}`) }); entries.push({ name: `Model_SmallThumbnail_${id}_${et}`, bytes: tinyPng() }); }
  }
  for (const [k, im] of Object.entries(fx.images ?? {})) {
    const id = imageIds[k]; const et = etagOf(++v);
    entries.push({ name: `Metadata_${id}`, bytes: Buffer.from(JSON.stringify({ DisplayName: `Image ${k}`, UpdatedMetadata: { Properties: { Format: im.kind === 'jpeg' ? 'Jpg' : 'Png' } }, ETag: `W/"${v}"`, VersionNumber: v })) });
    if (!im.omitBody) { entries.push({ name: `Image_Body_${id}_${et}`, bytes: im.kind === 'jpeg' ? tinyJpeg() : tinyPng() }); entries.push({ name: `Image_SmallThumbnail_${id}_${et}`, bytes: tinyPng() }); }
  }
  for (const [k, id] of Object.entries(videoIds)) { const et = etagOf(++v); entries.push({ name: `Metadata_${id}`, bytes: Buffer.from(JSON.stringify({ DisplayName: `Video ${k}`, UpdatedMetadata: { Properties: { Format: 'Mp4' } }, ETag: `W/"${v}"` })) }); entries.push({ name: `Video_Body_${id}_${et}`, bytes: tinyMp4() }); }
  if (fx.unknownEntry) entries.push({ name: `Hologram_Body_${randomUUID()}_${etagOf(++v)}`, bytes: Buffer.from('?') });
  return { tar: writeTar(fx.shuffle ? shuffleIn(entries, rnd) : entries), ids: { guide: guideId, tasks: taskIds, steps: stepIds, placements: placementIds, models: modelIds, images: imageIds, videos: videoIds } };
}
