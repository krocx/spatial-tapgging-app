// body.ts - Guide_Manifest, Guide_Body and the asset metadata, read defensively.
//
// Guide_Body is one Dataverse OData response for the msmrw_guide record with
// its children expanded inline as flat arrays linked by GUID. Microsoft says
// these tables evolve quickly, so: a missing key is null or an empty list
// (counted as a warning), unknown keys are counted and ignored, option sets
// are read by raw value with the formatted label kept for fallback, lookups
// are `_<name>_value`. Nothing here throws on shape - only on "not JSON".
//
// Proprietary & Confidential · Applied Materials.

export type Rec = Record<string, unknown>;
export const FV = '@OData.Community.Display.V1.FormattedValue';

export interface Manifest { packagedGuideId?: string; solutionVersion?: string; guideUri?: string; guideId?: string; guideName?: string; raw: Rec }

export interface GuideRoot {
  id:            string;
  name:          string;
  integrationKey?: string;
  schemaVersion?: number;
  anchorType?:   number;  anchorTypeLabel?: string;
  anchorObjectId?: string; anchorObjectStyle?: number; anchorInstruction?: string; anchorImageId?: string; anchorVideoId?: string;
  completion:    { text?: string; imageId?: string; videoId?: string; attention?: Attention };
  tasks:         Task[];
  steps:         Step[];
  stepObjects:   StepObject[];
  placements:    Placement[];
  completionObjects: StepObject[];
  completionPlacements: Placement[];
  /** Keys on the root the reader did not expect (counted, never logged by name at info). */
  unknownKeys:   number;
  missing:       string[];   // expected child arrays that were absent
}
export interface Task { id: string; name?: string; previousTaskId?: string | null; raw: Rec }
export interface Response { text?: string; action?: number; actionLabel?: string; stepId?: string | null }
export interface Attention { endpointType?: number; endpointLabel?: string; placementId?: string | null; isPlaced?: boolean; position?: Vec3; rotation?: Quat }
export interface Step {
  id: string; text: string; taskId?: string | null; previousStepId?: string | null;
  templateType?: number; templateLabel?: string;
  imageId?: string | null; videoId?: string | null;
  actionType?: number; actionUrl?: string;
  responses: Response[];
  attention?: Attention;
  raw: Rec;
}
export interface StepObject { id: string; stepId?: string | null; assetId?: string | null; index?: number; triggerAction?: number; triggerActivation?: number; triggerDestinationId?: string | null; raw: Rec }
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Placement {
  id: string; stepObjectId?: string | null; assetId?: string | null;
  position?: Vec3; rotation?: Quat; scale?: Vec3;
  isPlaced?: boolean; isInteractable?: boolean; ghost?: boolean;
  style?: number; styleLabel?: string;
  animated?: boolean; animationMode?: number; animationModeLabel?: string; animationDirection?: boolean; animationSpeed?: number; animationTake?: string | null;
  triggerActivation?: number; triggerAction?: number; triggerDestinationId?: string | null;
  raw: Rec;
}
export interface AssetMeta {
  guid: string; displayName?: string; format?: string; etag?: string; versionNumber?: string | number;
  contentLinks?: string[]; stats?: Record<string, number>; raw: Rec;
}
export interface GuideMeta { created?: string; updated?: string; parentFolderName?: string; folderHierarchy?: unknown[]; raw: Rec }

const str = (v: unknown): string | undefined => typeof v === 'string' ? v : (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean | undefined => typeof v === 'boolean' ? v : undefined;
const guid = (v: unknown): string | null | undefined => v === null ? null : (typeof v === 'string' && v ? v.toLowerCase() : undefined);
const arr = (v: unknown): Rec[] => Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === 'object') : [];
const vec3 = (r: Rec, p: string): Vec3 | undefined => { const x = num(r[p + 'x']), y = num(r[p + 'y']), z = num(r[p + 'z']); return x !== undefined && y !== undefined && z !== undefined ? [x, y, z] : undefined; };
const quat = (r: Rec, p: string): Quat | undefined => { const v = vec3(r, p), w = num(r[p + 'w']); return v && w !== undefined ? [v[0], v[1], v[2], w] : undefined; };

export function parseJsonEntry(bytes: Buffer, what: string): Rec {
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object'); return v as Rec; }
  catch (e) { throw new Error(`${what} is not valid JSON (${(e as Error).message})`); }
}

export function parseManifest(raw: Rec): Manifest {
  return { packagedGuideId: str(raw.PackagedGuideId), solutionVersion: str(raw.GuideSolutionVersion), guideUri: str(raw.GuideUri), guideId: str(raw.GuideId)?.toLowerCase(), guideName: str(raw.GuideName), raw };
}

export function parseGuideMeta(raw: Rec): GuideMeta {
  const props = (raw.Properties && typeof raw.Properties === 'object' ? raw.Properties : raw) as Rec;
  let hierarchy: unknown[] | undefined;
  const fh = props.FolderHierarchy;
  if (typeof fh === 'string') { try { const v = JSON.parse(fh); if (Array.isArray(v)) hierarchy = v; } catch { /* a string that is not JSON: ignored */ } }
  else if (Array.isArray(fh)) hierarchy = fh;
  return { created: str(raw.CreatedTime ?? raw.Created ?? props.CreatedTime), updated: str(raw.UpdatedTime ?? raw.Updated ?? props.UpdatedTime), parentFolderName: str(props.ParentFolderName), folderHierarchy: hierarchy, raw };
}

export function parseAssetMeta(guidFromName: string, raw: Rec): AssetMeta {
  const um = (raw.UpdatedMetadata && typeof raw.UpdatedMetadata === 'object' ? raw.UpdatedMetadata : {}) as Rec;
  const props = (um.Properties && typeof um.Properties === 'object' ? um.Properties : {}) as Rec;
  const links = Array.isArray(um.ContentLinks) ? um.ContentLinks.filter((x): x is string => typeof x === 'string') : undefined;
  const stats: Record<string, number> = {};
  for (const k of ['VertexCount', 'MeshCount', 'MaterialCount', 'TextureCount', 'IndexCount', 'TriangleCount']) { const v = num(props[k] ?? um[k] ?? raw[k]); if (v !== undefined) stats[k] = v; }
  return { guid: guidFromName, displayName: str(raw.DisplayName ?? um.DisplayName), format: str(props.Format ?? um.Format), etag: str(raw.ETag ?? um.ETag), versionNumber: (raw.VersionNumber ?? um.VersionNumber) as string | number | undefined, contentLinks: links, stats, raw };
}

const KNOWN_ROOT_KEYS = new Set([
  '@odata.context', '@odata.etag', 'msmrw_guideid', 'msmrw_name', 'msmrw_integrationkey', 'msmrw_schemaversion', 'msmrw_anchortype', '_msmrw_anchor3dobject_value',
  'msmrw_anchor3dobjectstyle', 'msmrw_anchorstepinstructiontext', '_msmrw_anchorstepimage_value', '_msmrw_anchorstepvideo_value', '_msdyn_anchorobjectanchor_value',
  'msmrw_completioninstructiontext', '_msmrw_completionimage_value', '_msmrw_completionvideo_value', '_msmrw_completionattentiondirector3dobject_value',
  'msmrw_GuideTask_Guide_msmrw_guide', 'msmrw_GuideStep_Guide_msmrw_guide', 'msmrw_msmrw_guide_msmrw_guidestepobject_Guide', 'msmrw_msmrw_guide_msmrw_guidestepobjectplacement_Guide',
  'msmrw_msmrw_guide_msmrw_guidecompletionstepobject_Guide', 'msmrw_msmrw_guide_msmrw_guidecompletionstepobjectplacement_Guide',
]);

function attention(r: Rec, p: string): Attention | undefined {
  const endpointType = num(r[`${p}endpointtype`]); const placementId = guid(r[`_${p}3dobject_value`]);
  const isPlaced = bool(r[`${p}isplaced`]); const position = vec3(r, `${p}position`); const rotation = quat(r, `${p}rotation`);
  if (endpointType === undefined && placementId === undefined && position === undefined) return undefined;
  return { endpointType, endpointLabel: str(r[`${p}endpointtype${FV}`]), placementId, isPlaced, position, rotation };
}

/** The root and its flat child lists. `missing` names the expected arrays that were absent. */
export function parseGuideBody(raw: Rec): GuideRoot {
  const missing: string[] = [];
  const list = (key: string): Rec[] => { if (!(key in raw)) missing.push(key); return arr(raw[key]); };
  let unknownKeys = 0;
  for (const k of Object.keys(raw)) if (!KNOWN_ROOT_KEYS.has(k) && !k.includes('@OData') && !k.includes('@Microsoft')) unknownKeys++;

  const tasks: Task[] = list('msmrw_GuideTask_Guide_msmrw_guide').map(r => ({ id: String(guid(r.msmrw_guidetaskid) ?? ''), name: str(r.msmrw_name), previousTaskId: guid(r._msmrw_previoustask_value), raw: r })).filter(t => t.id);
  const steps: Step[] = list('msmrw_GuideStep_Guide_msmrw_guide').map(r => {
    const responses: Response[] = [];
    for (let n = 1; n <= 3; n++) {
      const text = str(r[`msmrw_response${n}text`]), action = num(r[`msmrw_response${n}actiontype`]), stepId = guid(r[`_msmrw_response${n}step_value`]);
      if (text !== undefined || action !== undefined || stepId !== undefined) responses.push({ text, action, actionLabel: str(r[`msmrw_response${n}actiontype${FV}`]), stepId });
    }
    return {
      id: String(guid(r.msmrw_guidestepid) ?? ''), text: str(r.msmrw_instructiontext) ?? '', taskId: guid(r._msmrw_task_value), previousStepId: guid(r._msmrw_previousstep_value),
      templateType: num(r.msmrw_steptemplatetype), templateLabel: str(r[`msmrw_steptemplatetype${FV}`]),
      imageId: guid(r._msmrw_image_value), videoId: guid(r._msmrw_video_value), actionType: num(r.msmrw_actiontype), actionUrl: str(r.msmrw_actionurl),
      responses, attention: attention(r, 'msmrw_attentiondirector'), raw: r,
    };
  }).filter(s => s.id);
  const stepObject = (r: Rec): StepObject => ({
    id: String(guid(r.msmrw_guidestepobjectid ?? r.msmrw_guidecompletionstepobjectid) ?? ''), stepId: guid(r._msmrw_guidestep_value), assetId: guid(r._msmrw_3dobject_value), index: num(r.msmrw_index),
    triggerAction: num(r.msmrw_guidestepobjecttriggeraction), triggerActivation: num(r.msmrw_guidestepobjecttriggeractivation), triggerDestinationId: guid(r._msmrw_guidestepobjecttriggerdestination_value), raw: r,
  });
  const placement = (r: Rec): Placement => ({
    id: String(guid(r.msmrw_guidestepobjectplacementid ?? r.msmrw_guidecompletionstepobjectplacementid) ?? ''),
    stepObjectId: guid(r._msmrw_guidestepobject_value ?? r._msmrw_guidecompletionstepobject_value), assetId: guid(r._msmrw_3dobject_value),
    position: vec3(r, 'msmrw_position'), rotation: quat(r, 'msmrw_rotation'), scale: vec3(r, 'msmrw_scale'),
    isPlaced: bool(r.msmrw_isplaced), isInteractable: bool(r.msmrw_isinteractable), ghost: bool(r.msmrw_objectghostisenabled),
    style: num(r.msmrw_3dobjectstyle), styleLabel: str(r[`msmrw_3dobjectstyle${FV}`]),
    animated: bool(r.msmrw_3dobjectisanimated), animationMode: num(r.msmrw_3dobjectanimationmode), animationModeLabel: str(r[`msmrw_3dobjectanimationmode${FV}`]),
    animationDirection: bool(r.msmrw_3dobjectanimationdirection), animationSpeed: num(r.msmrw_3dobjectanimationspeed), animationTake: r.msmrw_3dobjectanimationtake === null ? null : str(r.msmrw_3dobjectanimationtake),
    triggerActivation: num(r.msmrw_triggeractivation), triggerAction: num(r.msmrw_triggeraction), triggerDestinationId: guid(r._msmrw_triggerdestination_value), raw: r,
  });
  return {
    id: String(guid(raw.msmrw_guideid) ?? ''), name: str(raw.msmrw_name) ?? '', integrationKey: str(raw.msmrw_integrationkey), schemaVersion: num(raw.msmrw_schemaversion),
    anchorType: num(raw.msmrw_anchortype), anchorTypeLabel: str(raw[`msmrw_anchortype${FV}`]),
    anchorObjectId: guid(raw._msmrw_anchor3dobject_value) ?? undefined, anchorObjectStyle: num(raw.msmrw_anchor3dobjectstyle), anchorInstruction: str(raw.msmrw_anchorstepinstructiontext),
    anchorImageId: guid(raw._msmrw_anchorstepimage_value) ?? undefined, anchorVideoId: guid(raw._msmrw_anchorstepvideo_value) ?? undefined,
    completion: { text: str(raw.msmrw_completioninstructiontext), imageId: guid(raw._msmrw_completionimage_value) ?? undefined, videoId: guid(raw._msmrw_completionvideo_value) ?? undefined, attention: attention(raw, 'msmrw_completionattentiondirector') },
    tasks, steps,
    stepObjects: list('msmrw_msmrw_guide_msmrw_guidestepobject_Guide').map(stepObject).filter(o => o.id),
    placements: list('msmrw_msmrw_guide_msmrw_guidestepobjectplacement_Guide').map(placement).filter(p => p.id),
    completionObjects: list('msmrw_msmrw_guide_msmrw_guidecompletionstepobject_Guide').map(stepObject).filter(o => o.id),
    completionPlacements: list('msmrw_msmrw_guide_msmrw_guidecompletionstepobjectplacement_Guide').map(placement).filter(p => p.id),
    unknownKeys, missing,
  };
}

// ── Ordering: walk the previous-links; never loop; append leftovers stably ──

export interface Ordered<T> { items: T[]; warnings: string[] }

/** Order by a `previous` link: start from every item whose previous is null or
 *  dangling, follow next-pointers; cycles and orphans are appended in their
 *  source order with a warning. `label` names the kind in warnings. */
export function orderByPrevious<T extends { id: string }>(items: T[], prevOf: (t: T) => string | null | undefined, label: string): Ordered<T> {
  const warnings: string[] = [];
  const byId = new Map(items.map(i => [i.id, i]));
  const nextOf = new Map<string, T[]>();
  for (const it of items) { const p = prevOf(it); if (p && byId.has(p)) (nextOf.get(p) ?? nextOf.set(p, []).get(p)!).push(it); }
  const heads = items.filter(it => { const p = prevOf(it); return !p || !byId.has(p); });
  const dangling = items.filter(it => { const p = prevOf(it); return p && !byId.has(p); }).length;
  if (dangling) warnings.push(`${dangling} ${label}(s) point at a previous ${label} that is not in the package - treated as a head`);
  if (heads.length > 1) warnings.push(`${heads.length} ${label} chains found (multiple heads) - joined in source order`);
  const out: T[] = []; const seen = new Set<string>();
  const walk = (start: T) => { let cur: T | undefined = start; let guard = 0; while (cur && !seen.has(cur.id) && guard++ < items.length + 1) { seen.add(cur.id); out.push(cur); const nx: T[] = nextOf.get(cur.id) ?? []; if (nx.length > 1) warnings.push(`${label} has ${nx.length} successors - the first in source order is followed, the rest appended`); cur = nx[0]; } };
  for (const h of heads) walk(h);
  const left = items.filter(i => !seen.has(i.id));
  if (left.length) { warnings.push(`${left.length} ${label}(s) in a cycle or unreachable - appended in source order`); for (const l of left) walk(l); }
  return { items: out, warnings };
}
