// importer.ts - a Dynamics 365 Guides `.guide` package → ImportedGuide + assembly GLB.
//
// Pipeline (docs/DYNAMICS-GUIDES-IMPORT.md; the adapter README beside this file):
//   .guide (plain tar) ─▶ entries ─▶ Guide_Manifest · Guide_Body · Metadata_* · asset bodies
//   Guide_Body ─▶ tasks (ordered by previous-task) ─▶ steps (ordered by previous-step, per task)
//   step objects ─▶ placements (isplaced only) ─▶ one node per placement in ONE assembly GLB
//   (glb-merge.ts), in the Guides anchor frame converted to SIB's (assets.ts)
//   each step ─▶ nodes[] deltas: its placements shown (solid / ghost / colour / animation),
//   everything else hidden; cadPosition = attention director, else the placements' centroid
//   question steps ─▶ nextOnSuccessSeq / nextOnFailureSeq (two passes); completion ─▶ last step
//   media ─▶ first image is the step image (bytes handed back, not a URL); video / audio → links
//
// The report is CONTENT-FREE: counts, GUIDs, enum labels, warnings - never
// instruction text, asset names or URLs at info level.
//
// Proprietary & Confidential · Applied Materials.

import type { ImportedGuide, ImportedGuideStep, GuideStepNode, AssemblyPose } from '@spatial/shared';
import { readTar, parseEntryName, decodeEtag, type TarEntry, type TarLimits, DEFAULT_TAR_LIMITS } from './tar.js';
import { parseJsonEntry, parseManifest, parseGuideBody, parseGuideMeta, parseAssetMeta, orderByPrevious, type GuideRoot, type Step, type Placement, type AssetMeta, type Manifest, type GuideMeta } from './body.js';
import { sniff, normalizeQuat, convertPosition, convertRotation, convertScale, quatToAxisAngle, DEFAULT_FRAME, type FrameConversion, type Sniffed } from './assets.js';
import { mergeGlbs, type MergeNodeSpec, type MergeStats } from './glb-merge.js';
import { STEP_TEMPLATE, RESPONSE_ACTION, ANCHOR_TYPE, ATTENTION_ENDPOINT, ANIMATION_MODE, labelOf, styleToNode, isStockHologram } from './enums.js';

export interface DynamicsImportOptions {
  name?:    string;
  frame?:   FrameConversion;
  limits?:  TarLimits;
  /** Import the "Invisible" stock object hidden (default) or drop it. */
  invisible?: 'hidden' | 'drop';
}

export interface ImportedMedia { guid: string; kind: 'image' | 'video' | 'audio'; sniffed: Sniffed; bytes: Buffer; etag?: string }

export interface DynamicsImportReport {
  source:     { bytes: number; entries: number; unknownEntries: number };
  manifest:   { guideId?: string; solutionVersion?: string; schemaVersion?: number };
  anchor:     { type?: number; label: string; known: boolean; hasObject: boolean; hasInstruction: boolean; poseEstimated: boolean };
  folder:     { hierarchyDepth: number; parentFolder: boolean };
  tasks:      number;
  steps:      { total: number; default: number; question: number; completion: number; withImage: number; withVideo: number; withAttention: number; withText: number };
  branching:  { responses: number; goToStep: number; goToNext: number; noAction: number; crossTask: number; unresolved: number; foldedToLinear: number };
  objects:    { stepObjects: number; placements: number; unplaced: number; withoutPlacement: number; completionObjects: number; completionPlacements: number; stock: number; invisible: number; animated: number; triggers: number; rotationRepaired: number };
  styles:     Record<string, number>;
  assets:     { models: number; images: number; videos: number; audio: number; unknownKind: number; referencedMissing: number; unreferenced: number; formatMismatch: number };
  merge?:     MergeStats;
  media:      { stepImages: number; videosAsLinks: number; audioAsLinks: number };
  enums:      { unknownValues: number; labelsUsed: number };
  unmapped:   string[];      // Guides concepts SIB has no place for (counted in warnings too)
  missingKeys: string[];
  unknownRootKeys: number;
  warnings:   string[];
}

export interface DynamicsImportResult {
  imported:  ImportedGuide;
  /** The assembly GLB (every placement a node), or null when the guide places nothing. */
  glb:       Buffer | null;
  bounds?:   { min: [number, number, number]; max: [number, number, number] };
  initialNodes: GuideStepNode[];
  /** Node name → the asset's display name, for Model3D.partLabels (what the Studio and the XR kit show). */
  partLabels: Record<string, string>;
  /** QR-anchored guide: the Guides anchor IS the printed QR, so the assembly's
   *  pose at the SIB QR is an estimate the author verifies once (source 'import'). */
  anchorPose?: AssemblyPose;
  /** Step images by 1-based sequence number, to be stored by the caller. */
  stepImages: Map<number, ImportedMedia>;
  /** Videos / audio the caller may store and link (optional; else links are dropped with a note). */
  media:     ImportedMedia[];
  /** Source ids for provenance: guide GUID, VersionNumber / ETag per asset. */
  provenance: { guideId: string; assets: { guid: string; etag?: string; versionNumber?: string | number }[] };
  report:    DynamicsImportReport;
}

const ANIM_SPEED_DEFAULT = 100;

export function importGuidePackage(input: Buffer, opts: DynamicsImportOptions = {}): DynamicsImportResult {
  const warnings: string[] = []; const unmapped = new Set<string>();
  const frame = opts.frame ?? DEFAULT_FRAME;
  const entries = readTar(input, opts.limits ?? DEFAULT_TAR_LIMITS);

  // ── Entries ─────────────────────────────────────────────────────────────
  let manifestRaw: TarEntry | undefined, bodyRaw: TarEntry | undefined;
  const metas = new Map<string, TarEntry>();
  const bodies = new Map<string, { kind: 'Model' | 'Image' | 'Video' | 'Audio'; entry: TarEntry; etag?: string }>();
  const thumbs = new Map<string, TarEntry>();
  let unknownEntries = 0; let guideMetaRaw: TarEntry | undefined;
  for (const e of entries) {
    const p = parseEntryName(e.name);
    if (p.kind === 'Guide_Manifest') manifestRaw = e;
    else if (p.kind === 'Guide_Body') bodyRaw = e;
    else if (p.kind === 'Metadata') { if (p.guid === '00000000-0000-0000-0000-000000000000') guideMetaRaw = e; else metas.set(p.guid!, e); }
    else if (p.kind === 'Unknown') unknownEntries++;
    else if (p.part === 'Body') bodies.set(p.guid!, { kind: p.kind, entry: e, etag: decodeEtag(p.etag) });
    else if (p.part === 'SmallThumbnail') thumbs.set(p.guid!, e);
  }
  if (!bodyRaw) throw new Error('The package has no Guide_Body entry');
  const manifest: Manifest = manifestRaw ? parseManifest(parseJsonEntry(manifestRaw.bytes, 'Guide_Manifest')) : { raw: {} };
  if (!manifestRaw) warnings.push('no Guide_Manifest entry - guide identity taken from Guide_Body');
  const root: GuideRoot = parseGuideBody(parseJsonEntry(bodyRaw.bytes, 'Guide_Body'));
  const guideMeta: GuideMeta = guideMetaRaw ? parseGuideMeta(parseJsonEntry(guideMetaRaw.bytes, 'guide metadata')) : { raw: {} };
  for (const m of root.missing) warnings.push(`Guide_Body has no "${m}" array - treated as empty`);

  // ── Asset index ─────────────────────────────────────────────────────────
  interface Asset { guid: string; meta?: AssetMeta; kind?: 'Model' | 'Image' | 'Video' | 'Audio'; bytes?: Buffer; sniffed?: Sniffed; etag?: string }
  const assets = new Map<string, Asset>();
  for (const [g, e] of metas) assets.set(g, { guid: g, meta: parseAssetMeta(g, parseJsonEntry(e.bytes, `Metadata_${g.slice(0, 8)}`)) });
  let formatMismatch = 0;
  for (const [g, b] of bodies) {
    const a = assets.get(g) ?? { guid: g }; a.kind = b.kind; a.bytes = b.entry.bytes; a.sniffed = sniff(b.entry.bytes); a.etag = b.etag; assets.set(g, a);
    const fmt = a.meta?.format?.toLowerCase();
    if (fmt && ((fmt === 'gltf' && a.sniffed === 'glb') || (fmt === 'png' && a.sniffed === 'jpeg') || (fmt === 'jpg' && a.sniffed === 'png'))) formatMismatch++;
  }
  const assetCounts = { models: 0, images: 0, videos: 0, audio: 0 };
  for (const a of assets.values()) { if (a.kind === 'Model') assetCounts.models++; else if (a.kind === 'Image') assetCounts.images++; else if (a.kind === 'Video') assetCounts.videos++; else if (a.kind === 'Audio') assetCounts.audio++; }

  // ── Order tasks and steps ───────────────────────────────────────────────
  const tasksO = orderByPrevious(root.tasks, t => t.previousTaskId, 'task'); warnings.push(...tasksO.warnings);
  const taskIds = tasksO.items.map(t => t.id);
  const stepsByTask = new Map<string, Step[]>();
  const orphanSteps: Step[] = [];
  for (const s of root.steps) { if (s.taskId && taskIds.includes(s.taskId)) (stepsByTask.get(s.taskId) ?? stepsByTask.set(s.taskId, []).get(s.taskId)!).push(s); else orphanSteps.push(s); }
  if (orphanSteps.length) warnings.push(`${orphanSteps.length} step(s) belong to no task in the package - appended as a final section`);
  const ordered: { step: Step; taskName?: string; taskIndex: number }[] = [];
  tasksO.items.forEach((t, ti) => { const o = orderByPrevious(stepsByTask.get(t.id) ?? [], s => s.previousStepId, 'step'); warnings.push(...o.warnings.map(w => `task ${ti + 1}: ${w}`)); for (const s of o.items) ordered.push({ step: s, taskName: t.name, taskIndex: ti }); });
  if (orphanSteps.length) { const o = orderByPrevious(orphanSteps, s => s.previousStepId, 'step'); for (const s of o.items) ordered.push({ step: s, taskIndex: tasksO.items.length }); }
  // The completion step: Guides keeps its text on the guide, not as a step record, unless a Completion-type step exists.
  const hasCompletionStep = ordered.some(o => o.step.templateType === STEP_TEMPLATE.Completion);

  // ── Placements → nodes ──────────────────────────────────────────────────
  const objById = new Map(root.stepObjects.map(o => [o.id, o]));
  const placementsByStep = new Map<string, Placement[]>();
  let unplaced = 0, withoutPlacement = 0, stockCount = 0, invisibleCount = 0, animatedCount = 0, triggerCount = 0, referencedMissing = 0, rotationRepaired = 0;
  const styles: Record<string, number> = {}; let unknownEnumValues = 0, labelsUsed = 0;
  const objHasPlacement = new Set<string>();
  for (const p of root.placements) {
    if (!p.stepObjectId || !objById.has(p.stepObjectId)) { warnings.push(`placement ${p.id.slice(0, 8)} refers to a step object not in the package - skipped`); continue; }
    objHasPlacement.add(p.stepObjectId);
    if (p.isPlaced === false) { unplaced++; continue; }
    const o = objById.get(p.stepObjectId)!; if (!o.stepId) continue;
    (placementsByStep.get(o.stepId) ?? placementsByStep.set(o.stepId, []).get(o.stepId)!).push(p);
  }
  for (const o of root.stepObjects) { if (!objHasPlacement.has(o.id)) withoutPlacement++; if (o.triggerAction !== undefined && o.triggerAction !== 937380000) triggerCount++; }
  const completionPlacements = root.completionPlacements.filter(p => p.isPlaced !== false);
  const nodeSpecs: MergeNodeSpec[] = []; const glbs = new Map<string, Buffer>();
  const nodeByPlacement = new Map<string, string>();
  const labelByNode = new Map<string, string>();   // the asset's display name - guide content, carried on the step node, never logged
  const nodeFor = (p: Placement, where: string): string | null => {
    const assetId = p.assetId ?? (p.stepObjectId ? objById.get(p.stepObjectId)?.assetId : undefined) ?? undefined;
    if (!assetId) { warnings.push(`placement ${p.id.slice(0, 8)} has no 3D object - skipped`); return null; }
    const a = assets.get(assetId);
    if (!a?.bytes || a.kind !== 'Model') { referencedMissing++; warnings.push(`placement ${p.id.slice(0, 8)} refers to model ${assetId.slice(0, 8)} with no Model_Body in the package - skipped`); return null; }
    if (a.sniffed !== 'glb') { warnings.push(`model ${assetId.slice(0, 8)} is not a GLB (${a.sniffed}) - skipped`); return null; }
    const name = a.meta?.displayName;
    const stock = isStockHologram(name); if (stock) stockCount++;
    const invisible = name?.trim().toLowerCase() === 'invisible'; if (invisible) { invisibleCount++; if (opts.invisible === 'drop') return null; }
    glbs.set(assetId, a.bytes);
    const node = `pl:${p.id}`;
    // A (0,0,0,0) rotation is not a rotation; it is repaired to identity and
    // counted - never written into the GLB, where iOS would draw nothing.
    const rot = p.rotation ? normalizeQuat(p.rotation) : undefined; if (rot?.repaired) rotationRepaired++;
    nodeSpecs.push({ name: node, assetKey: assetId,
      translation: p.position ? convertPosition(p.position, frame) : undefined, rotation: rot ? convertRotation(rot.q, frame) : undefined, scale: p.scale ? convertScale(p.scale) : undefined,
      // displayName is what the Studio's parts list, the XR kit's chips and the
      // app show for the node (the Cortona convention) - guide content, not log.
      extras: { sibSource: 'dynamics', placementId: p.id, assetId, where, ...(name?.trim() ? { displayName: name.trim() } : {}), ...(stock ? { stock: true } : {}), ...(invisible ? { invisible: true } : {}) } });
    nodeByPlacement.set(p.id, node); if (name?.trim()) labelByNode.set(node, name.trim());
    return node;
  };

  // ── Steps ────────────────────────────────────────────────────────────────
  const steps: ImportedGuideStep[] = []; const seqByStepId = new Map<string, number>();
  const counts = { default: 0, question: 0, completion: 0, withImage: 0, withVideo: 0, withAttention: 0, withText: 0 };
  const stepImages = new Map<number, ImportedMedia>(); const media: ImportedMedia[] = [];
  const mediaCounts = { stepImages: 0, videosAsLinks: 0, audioAsLinks: 0 };
  const allNodeNames: string[] = [];
  const stepNodes = new Map<number, GuideStepNode[]>();
  const stepCentroid = new Map<number, [number, number, number]>();

  const useAttention = (att: Step['attention'] | undefined, seq: number): [number, number, number] | undefined => {
    if (!att) return undefined;
    counts.withAttention++;
    if (att.endpointType === ATTENTION_ENDPOINT.ThreeDObject && att.placementId) {
      const n = nodeByPlacement.get(att.placementId); if (n) { (stepNodes.get(seq) ?? []).push({ node: n, effect: 'flash' } as GuideStepNode); }
      const p = [...root.placements, ...root.completionPlacements].find(x => x.id === att.placementId); if (p?.position) return convertPosition(p.position, frame);
    }
    if (att.position && att.isPlaced !== false) return convertPosition(att.position, frame);
    if (att.endpointType !== undefined && att.endpointType !== ATTENTION_ENDPOINT.NoAttachment && att.endpointType !== ATTENTION_ENDPOINT.ThreeDObject) { unknownEnumValues++; unmapped.add(`attention director endpoint "${labelOf(att.endpointType, att.endpointLabel, ATTENTION_ENDPOINT)}"`); }
    return undefined;
  };

  ordered.forEach(({ step, taskName, taskIndex }, i) => {
    const seq = i + 1; seqByStepId.set(step.id, seq);
    const t = step.templateType;
    if (t === STEP_TEMPLATE.Question) counts.question++; else if (t === STEP_TEMPLATE.Completion) counts.completion++; else { counts.default++; if (t !== undefined && t !== STEP_TEMPLATE.Default) { unknownEnumValues++; warnings.push(`step ${seq}: unknown step template ${labelOf(t, step.templateLabel, STEP_TEMPLATE)} - treated as default`); } }
    if (step.text.trim()) counts.withText++;
    const nodes: GuideStepNode[] = []; stepNodes.set(seq, nodes);
    const pls = placementsByStep.get(step.id) ?? [];
    const pts: [number, number, number][] = [];
    for (const p of pls) {
      const node = nodeFor(p, `step ${seq}`); if (!node) continue;
      allNodeNames.push(node);
      const st = styleToNode(p.style, p.styleLabel); const key = labelOf(p.style, p.styleLabel, { Original: 937380000, XRay: 937380007, Green: 937380009 }); styles[key] = (styles[key] ?? 0) + 1;
      if (!st.known) { unknownEnumValues++; if (p.styleLabel) labelsUsed++; }
      const invisible = assets.get(p.assetId ?? objById.get(p.stepObjectId ?? '')?.assetId ?? '')?.meta?.displayName?.trim().toLowerCase() === 'invisible';
      const d: GuideStepNode = { node, show: invisible ? 'hidden' : (p.ghost ? 'ghost' : st.show), ...(st.show === 'ghost' || p.ghost ? { opacity: 0.45 } : {}), ...(st.color ? { color: st.color } : {}), sourceKey: p.id, ...(labelByNode.has(node) ? { label: labelByNode.get(node) } : {}) };
      if (p.animated) {
        // A Guides animation is a glTF clip baked in the asset (merged and
        // re-targeted under this node): the players run it while shown.
        animatedCount++; d.clip = { play: true, loop: p.animationMode === undefined || p.animationMode === ANIMATION_MODE.Loop };
        if (p.animationMode !== undefined && p.animationMode !== ANIMATION_MODE.Loop) { unknownEnumValues++; unmapped.add(`animation mode "${labelOf(p.animationMode, p.animationModeLabel, ANIMATION_MODE)}"`); }
        if (p.animationSpeed !== undefined && p.animationSpeed !== ANIM_SPEED_DEFAULT) unmapped.add('animation speed per placement');
        if (p.animationDirection === false) unmapped.add('reverse animation direction');
        if (p.animationTake) unmapped.add('animation take (clip) selection');
      }
      if (p.triggerAction !== undefined && p.triggerAction !== 937380000) { triggerCount++; unmapped.add('placement triggers (activation → action / destination)'); }
      if (p.isInteractable) unmapped.add('interactable placements');
      nodes.push(d);
      if (p.position) pts.push(convertPosition(p.position, frame));
    }
    const attPos = useAttention(step.attention, seq);
    const centroid = attPos ?? (pts.length ? pts.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]).map(v => v / pts.length) as [number, number, number] : undefined);
    if (centroid) stepCentroid.set(seq, centroid);
    // media
    let imageHandled = false;
    if (step.imageId) { const a = assets.get(step.imageId); if (a?.bytes && a.kind === 'Image' && (a.sniffed === 'png' || a.sniffed === 'jpeg')) { stepImages.set(seq, { guid: a.guid, kind: 'image', sniffed: a.sniffed, bytes: a.bytes, etag: a.etag }); counts.withImage++; mediaCounts.stepImages++; imageHandled = true; } else { referencedMissing++; warnings.push(`step ${seq}: image ${step.imageId.slice(0, 8)} is not in the package`); } }
    if (step.videoId) { const a = assets.get(step.videoId); if (a?.bytes && a.kind === 'Video') { media.push({ guid: a.guid, kind: 'video', sniffed: a.sniffed ?? 'unknown', bytes: a.bytes, etag: a.etag }); counts.withVideo++; mediaCounts.videosAsLinks++; } else { referencedMissing++; warnings.push(`step ${seq}: video ${step.videoId.slice(0, 8)} is not in the package`); } }
    void imageHandled;
    const title = taskName ? `${taskName}` : undefined;
    const s: ImportedGuideStep = {
      sequenceNumber: seq, text: step.text || (t === STEP_TEMPLATE.Completion ? 'Procedure complete.' : ''),
      ...(title ? { title: title.length > 60 ? title.slice(0, 59) + '…' : title } : {}),
      section: taskName ?? `Task ${taskIndex + 1}`,
      completionRequired: true,
      ...(t === STEP_TEMPLATE.Completion ? { evidenceRequired: true } : {}),
      ...(centroid ? { cadPosition: centroid } : {}),
      ...(step.actionUrl && /^https?:\/\//i.test(step.actionUrl) ? { linkUrl: step.actionUrl } : {}),
    };
    if (step.actionType !== undefined && step.actionType !== 937380000) { unknownEnumValues++; unmapped.add('step action type'); }
    steps.push(s);
  });

  // The guide-level completion (text, media, objects) becomes the last step when no Completion-type step exists.
  if (!hasCompletionStep && (root.completion.text || completionPlacements.length || root.completion.imageId)) {
    const seq = steps.length + 1; const nodes: GuideStepNode[] = []; stepNodes.set(seq, nodes); const pts: [number, number, number][] = [];
    for (const p of completionPlacements) { const node = nodeFor(p, 'completion'); if (!node) continue; allNodeNames.push(node); const st = styleToNode(p.style, p.styleLabel); nodes.push({ node, show: st.show, ...(st.color ? { color: st.color } : {}), sourceKey: p.id, ...(labelByNode.has(node) ? { label: labelByNode.get(node) } : {}) }); if (p.position) pts.push(convertPosition(p.position, frame)); }
    const attPos = useAttention(root.completion.attention, seq);
    const centroid = attPos ?? (pts.length ? pts.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]).map(v => v / pts.length) as [number, number, number] : undefined);
    if (root.completion.imageId) { const a = assets.get(root.completion.imageId); if (a?.bytes && a.kind === 'Image' && (a.sniffed === 'png' || a.sniffed === 'jpeg')) { stepImages.set(seq, { guid: a.guid, kind: 'image', sniffed: a.sniffed, bytes: a.bytes, etag: a.etag }); mediaCounts.stepImages++; } }
    steps.push({ sequenceNumber: seq, title: 'Complete', section: 'Completion', text: root.completion.text || 'Procedure complete.', completionRequired: true, evidenceRequired: true, ...(centroid ? { cadPosition: centroid } : {}) });
    counts.completion++;
  }

  // ── Branching: two passes ───────────────────────────────────────────────
  const br = { responses: 0, goToStep: 0, goToNext: 0, noAction: 0, crossTask: 0, unresolved: 0, foldedToLinear: 0 };
  ordered.forEach(({ step, taskIndex }, i) => {
    if (step.templateType !== STEP_TEMPLATE.Question || !step.responses.length) return;
    const seq = i + 1; const s = steps[i];
    const resolved: { seq?: number; next?: boolean; text?: string }[] = [];
    for (const r of step.responses) {
      br.responses++;
      if (r.action === RESPONSE_ACTION.GoToStep) {
        br.goToStep++;
        const target = r.stepId ? seqByStepId.get(r.stepId) : undefined;
        if (!target) { br.unresolved++; warnings.push(`step ${seq}: a response points at a step not in the package - downgraded to next step`); resolved.push({ next: true, text: r.text }); }
        else { const tTask = ordered[target - 1]?.taskIndex; if (tTask !== undefined && tTask !== taskIndex) br.crossTask++; resolved.push({ seq: target, text: r.text }); }
      } else if (r.action === RESPONSE_ACTION.GoToNextStep) { br.goToNext++; resolved.push({ next: true, text: r.text }); }
      else if (r.action === RESPONSE_ACTION.NoAction || r.action === undefined) { br.noAction++; resolved.push({ text: r.text }); }
      else { unknownEnumValues++; warnings.push(`step ${seq}: unknown response action ${labelOf(r.action, r.actionLabel, RESPONSE_ACTION)} - treated as next step`); resolved.push({ next: true, text: r.text }); }
    }
    // SIB's graph: success and failure. First response → success, second → failure; a third is folded with a warning.
    const acting = resolved.filter(r => r.seq !== undefined || r.next);
    const first = acting[0], second = acting[1];
    if (first?.seq !== undefined && first.seq !== seq + 1) s.nextOnSuccessSeq = first.seq;
    if (second?.seq !== undefined) s.nextOnFailureSeq = second.seq;
    if (acting.length > 2) { br.foldedToLinear++; warnings.push(`step ${seq}: ${acting.length} responses - the first two are the branches, the rest need the Designer`); }
    // The question's responses stay visible to the operator as text, since SIB has no response buttons.
    const lines = resolved.map((r, k) => r.text ? `${k + 1}. ${r.text}` : null).filter(Boolean);
    if (lines.length) s.text = `${s.text}\n\n${lines.join('\n')}`.trim();
  });

  // ── Assembly GLB + initial state ────────────────────────────────────────
  let glb: Buffer | null = null; let bounds: DynamicsImportResult['bounds']; let merge: MergeStats | undefined;
  if (nodeSpecs.length) {
    const m = mergeGlbs(glbs, nodeSpecs, { rootName: root.name ? 'guide' : 'guide' });
    glb = m.glb; bounds = m.bounds; merge = m.stats; warnings.push(...m.stats.warnings);
  }
  // Each step: show its own placements, hide every other node. Initial state: everything hidden.
  const initialNodes: GuideStepNode[] = allNodeNames.map(n => ({ node: n, show: 'hidden' }));
  const shownBefore = new Set<string>();
  for (const s of steps) {
    const mine = stepNodes.get(s.sequenceNumber) ?? [];
    const mineNames = new Set(mine.map(n => n.node));
    const hide: GuideStepNode[] = [...shownBefore].filter(n => !mineNames.has(n)).map(n => ({ node: n, show: 'hidden' }));
    s.nodes = [...hide, ...mine];
    shownBefore.clear(); for (const n of mineNames) shownBefore.add(n);
    if (!s.nodes.length) delete s.nodes;
  }

  // ── Unreferenced assets ─────────────────────────────────────────────────
  const referenced = new Set<string>();
  for (const p of [...root.placements, ...root.completionPlacements]) { const a = p.assetId ?? objById.get(p.stepObjectId ?? '')?.assetId; if (a) referenced.add(a); }
  for (const s of root.steps) { if (s.imageId) referenced.add(s.imageId); if (s.videoId) referenced.add(s.videoId); }
  if (root.completion.imageId) referenced.add(root.completion.imageId); if (root.completion.videoId) referenced.add(root.completion.videoId);
  if (root.anchorObjectId) referenced.add(root.anchorObjectId); if (root.anchorImageId) referenced.add(root.anchorImageId);
  const unreferenced = [...assets.keys()].filter(g => !referenced.has(g)).length;
  if (unreferenced) warnings.push(`${unreferenced} asset(s) in the package are not used by any step`);
  if (rotationRepaired) warnings.push(`${rotationRepaired} placement(s) carry a (0,0,0,0) rotation - imported as no rotation`);

  // ── Anchor ──────────────────────────────────────────────────────────────
  const anchorKnown = root.anchorType === ANCHOR_TYPE.Holographic;
  const anchorLabel = labelOf(root.anchorType, root.anchorTypeLabel, ANCHOR_TYPE);
  // A QR-anchored guide: placements are relative to the printed code, which is
  // the same code SIB anchors on. After the handedness flip the frames are
  // taken as coincident - an estimate (source 'import') the author checks on
  // the first guide; a tap, object or configuration pose replaces it. The
  // option-set value for QR is unverified, so the label decides.
  const anchorPose: AssemblyPose | undefined = /qr/i.test(anchorLabel) && glb
    ? { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1, source: 'import', setAt: new Date().toISOString(), setBy: 'dynamics-import' }
    : undefined;
  if (root.anchorType !== undefined && !anchorKnown) { unknownEnumValues++; if (root.anchorTypeLabel) labelsUsed++; }
  if (root.anchorObjectId) unmapped.add('anchor 3D object (holographic anchor model)');
  if (root.anchorInstruction) unmapped.add('anchor step instruction text');
  unmapped.add('placements are relative to the Guides anchor; the author places the assembly once at the SIB QR');

  const name = (opts.name ?? root.name ?? manifest.guideName ?? 'Imported guide').trim() || 'Imported guide';
  const imported: ImportedGuide = { name, description: `Imported from Dynamics 365 Guides${guideMeta.parentFolderName ? ` · ${guideMeta.parentFolderName}` : ''}`, steps };

  const report: DynamicsImportReport = {
    source: { bytes: input.length, entries: entries.length, unknownEntries },
    manifest: { guideId: root.id || manifest.guideId, solutionVersion: manifest.solutionVersion, schemaVersion: root.schemaVersion },
    anchor: { type: root.anchorType, label: anchorLabel, known: anchorKnown, hasObject: !!root.anchorObjectId, hasInstruction: !!root.anchorInstruction, poseEstimated: !!anchorPose },
    folder: { hierarchyDepth: guideMeta.folderHierarchy?.length ?? 0, parentFolder: !!guideMeta.parentFolderName },
    tasks: tasksO.items.length,
    steps: { total: steps.length, ...counts },
    branching: br,
    objects: { stepObjects: root.stepObjects.length, placements: root.placements.length, unplaced, withoutPlacement, completionObjects: root.completionObjects.length, completionPlacements: root.completionPlacements.length, stock: stockCount, invisible: invisibleCount, animated: animatedCount, triggers: triggerCount, rotationRepaired },
    styles,
    assets: { ...assetCounts, unknownKind: unknownEntries, referencedMissing, unreferenced, formatMismatch },
    ...(merge ? { merge } : {}),
    media: mediaCounts,
    enums: { unknownValues: unknownEnumValues, labelsUsed },
    unmapped: [...unmapped],
    missingKeys: root.missing, unknownRootKeys: root.unknownKeys,
    warnings,
  };
  if (root.schemaVersion !== undefined && (root.schemaVersion < 5 || root.schemaVersion > 6)) warnings.push(`schema version ${root.schemaVersion} is outside the tested range (5-6)`);

  return { imported, glb, bounds, initialNodes, partLabels: Object.fromEntries(labelByNode), ...(anchorPose ? { anchorPose } : {}), stepImages, media, provenance: { guideId: root.id || manifest.guideId || '', assets: [...assets.values()].map(a => ({ guid: a.guid, etag: a.etag ?? a.meta?.etag, versionNumber: a.meta?.versionNumber })) }, report };
}

/** The report as a person reads it. Content-free. */
export function reportText(r: DynamicsImportReport, name = 'guide'): string {
  const L: string[] = [];
  L.push(`${name}: ${r.tasks} task(s), ${r.steps.total} step(s) (${r.steps.default} default · ${r.steps.question} question · ${r.steps.completion} completion), schema v${r.manifest.schemaVersion ?? '?'}`);
  L.push(`anchor: ${r.anchor.label}${r.anchor.known ? '' : ' (unverified value)'}${r.anchor.hasObject ? ' · with anchor object' : ''}`);
  L.push(`objects: ${r.objects.stepObjects} step object(s), ${r.objects.placements} placement(s) (${r.objects.unplaced} not placed, ${r.objects.withoutPlacement} object(s) without placement), ${r.objects.completionPlacements} on completion, ${r.objects.stock} stock hologram(s), ${r.objects.animated} animated, ${r.objects.triggers} trigger(s)` + (r.objects.rotationRepaired ? `, ${r.objects.rotationRepaired} zero rotation(s) repaired to identity` : ''));
  L.push(`styles: ${Object.entries(r.styles).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  L.push(`assets: ${r.assets.models} model(s), ${r.assets.images} image(s), ${r.assets.videos} video(s), ${r.assets.audio} audio; ${r.assets.referencedMissing} referenced but missing, ${r.assets.unreferenced} unreferenced, ${r.assets.formatMismatch} format mismatch(es), ${r.assets.unknownKind} unknown entries`);
  if (r.merge) L.push(`assembly: ${r.merge.instances} instance(s) of ${r.merge.assets} model(s), ${r.merge.triangles} triangles, ${r.merge.animations} animation(s), ${r.merge.specGlossFolded} spec/gloss folded, ${r.merge.defaultMaterials} default material(s)`);
  L.push(`branching: ${r.branching.responses} response(s) - ${r.branching.goToStep} go-to-step (${r.branching.crossTask} cross-task), ${r.branching.goToNext} next, ${r.branching.noAction} no action; ${r.branching.unresolved} unresolved, ${r.branching.foldedToLinear} step(s) with more branches than SIB holds`);
  L.push(`media: ${r.media.stepImages} step image(s), ${r.media.videosAsLinks} video(s), ${r.media.audioAsLinks} audio`);
  L.push(`enums: ${r.enums.unknownValues} unknown value(s), ${r.enums.labelsUsed} resolved by label; ${r.unknownRootKeys} unknown root key(s); missing arrays: ${r.missingKeys.length ? r.missingKeys.join(', ') : 'none'}`);
  if (r.unmapped.length) { L.push('not represented in SIB (reported, not imported):'); for (const u of r.unmapped) L.push(`  - ${u}`); }
  if (r.warnings.length) { L.push(`warnings (${r.warnings.length}):`); for (const w of r.warnings) L.push(`  - ${w}`); }
  return L.join('\n');
}
