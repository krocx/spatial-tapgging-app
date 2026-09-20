// guides/bundle.ts — B1 (2026.4.46): the Guide Bundle.
//
// One versioned JSON document that carries everything a client needs to run
// a guide, on any engine: the guide, its ordered steps, the models it uses
// (with GLB URLs), the anchor and which frames it offers (QR marker, sealed
// world map, guide world map, scanned object), the validation references,
// and the playback conventions spelled out. The iOS app, the portal Guide
// Preview, a Unity/AR Foundation client and the WebXR kit all read this.
//
// The schema lives in docs/schema/guide-bundle.schema.json; the test in
// sib/test/guide-bundle.test.ts checks a built bundle against it. Bump
// BUNDLE_SCHEMA when a breaking change lands; additive fields do not.
//
// Pure: every lookup is injected so it can be built in tests without the
// file stores. URLs are server-relative; clients prefix their base URL and
// send the same auth headers they use for everything else.

import type { Anchor, Guide, GuideStep, Model3D } from '@spatial/shared';

export const BUNDLE_SCHEMA = 'sib.guide-bundle/1';

export interface BundleModel {
  id:            string;
  name:          string;
  role:          'assembly' | 'step';
  glbUrl?:       string;
  usdzUrl?:      string;
  defaultScale?: number;
  fileSizeBytes: number;
}

export interface BundleFrames {
  /** Printed QR on the equipment — always the fallback identity + frame. */
  qr: { available: boolean; markerSizeM?: number; anchorPose?: number[] };
  /** Anchor world map sealed by an author (ARKit; AR Foundation can apply it on iOS). */
  worldMap: { available: boolean; url?: string; sealedAt?: string };
  /** The guide's own world map (where tap-placed poses live). */
  guideWorldMap: { available: boolean; url?: string; photoUrl?: string; referenceCameraPose?: number[]; objectPoseInMap?: number[] };
  /** Scanned .arobject of the equipment (ARKit object detection). */
  object: { available: boolean; url?: string; calibrated?: boolean; objectPoseInQR?: number[] };
}

export interface BundleValidation {
  stepId:        string;
  required:      boolean;
  mode:          'single' | 'cone' | 'none';
  trainedAt?:    string;
  referenceUrl?: string;
  /** POST a JPEG here for a server verdict (single mode). */
  verdictUrl?:   string;
}

export interface GuideBundle {
  schema:      typeof BUNDLE_SCHEMA;
  generatedAt: string;
  guide:       Guide;
  steps:       GuideStep[];
  models:      BundleModel[];
  anchor: {
    id:          string;
    assetId:     string;
    anchorType:  string;
    configId?:   string;
    originSource?: string;
    frames:      BundleFrames;
  };
  validation:  BundleValidation[];
  playback: {
    animationSpeed: number;
    conventions: {
      units:      'm';
      up:         'Y';
      handedness: 'right';
      rotation:   'axis-angle-xyz-rad';
      quaternion: 'xyzw';
      matrices:   'column-major-16';
      timeline:   'cumulative-last-write-wins';
      /** Where UNITY-RUNTIME.md §4 is served from, for the reader. */
      contract:   string;
    };
  };
  links: { self: string; guide: string; steps: string; liveSession: string };
}

export interface BundleLookups {
  anchor:            (id: string) => Anchor | undefined;
  model:             (id: string) => Model3D | undefined;
  anchorWorldMap:    (anchorId: string) => { sealed: boolean; anchorPose?: number[]; capturedAt?: string };
  anchorObject:      (anchorId: string) => { available: boolean; calibrated: boolean; objectPoseInQR?: number[] } | undefined;
  guideWorldMap:     (guideId: string) => { available: boolean; photo: boolean; referenceCameraPose?: number[]; objectPoseInMap?: number[] };
  now?:              () => string;
}

export function buildGuideBundle(guide: Guide, steps: GuideStep[], look: BundleLookups): GuideBundle {
  const ordered = [...steps].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const anchor = look.anchor(guide.anchorId);

  // Models: the assembly first, then every step slot / legacy modelId, deduped.
  const models: BundleModel[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined, role: BundleModel['role']) => {
    if (!id || seen.has(id)) return;
    const m = look.model(id); if (!m) return;
    seen.add(id);
    models.push({
      id: m.id, name: m.name, role, fileSizeBytes: m.fileSizeBytes,
      ...(m.hasGLB && { glbUrl: `/models/${m.id}/file.glb` }),
      ...(m.hasUSDZ && { usdzUrl: `/models/${m.id}/file.usdz` }),
      ...(m.defaultScale !== undefined && { defaultScale: m.defaultScale }),
    });
  };
  push(guide.assembly?.modelId, 'assembly');
  for (const s of ordered) {
    for (const slot of s.models ?? []) push(slot.modelId, 'step');
    push(s.modelId, 'step');
  }

  const wm  = anchor ? look.anchorWorldMap(anchor.id) : { sealed: false };
  const obj = anchor ? look.anchorObject(anchor.id) : undefined;
  const gwm = look.guideWorldMap(guide.id);

  const frames: BundleFrames = {
    qr: {
      available: !!anchor && (anchor.anchorType === undefined || anchor.anchorType === 'QR' || anchor.anchorType === 'LOTO'),
      ...(anchor?.qrSizeCm !== undefined && { markerSizeM: anchor.qrSizeCm / 100 }),
      ...(wm.anchorPose && { anchorPose: wm.anchorPose }),
    },
    worldMap: {
      available: wm.sealed,
      ...(wm.sealed && anchor && { url: `/anchors/${anchor.id}/worldmap` }),
      ...(wm.capturedAt && { sealedAt: wm.capturedAt }),
    },
    guideWorldMap: {
      available: gwm.available,
      ...(gwm.available && { url: `/worldmap/guide/${guide.id}` }),
      ...(gwm.photo && { photoUrl: `/worldmap/guide/${guide.id}/photo` }),
      ...(gwm.referenceCameraPose && { referenceCameraPose: gwm.referenceCameraPose }),
      ...(gwm.objectPoseInMap && { objectPoseInMap: gwm.objectPoseInMap }),
    },
    object: {
      available: !!obj?.available,
      ...(obj?.available && anchor && { url: `/anchors/${anchor.id}/object`, calibrated: obj.calibrated }),
      ...(obj?.objectPoseInQR && { objectPoseInQR: obj.objectPoseInQR }),
    },
  };

  const validation: BundleValidation[] = ordered
    .filter(s => s.validationRequired || s.validationTrainedAt)
    .map(s => ({
      stepId:   s.id,
      required: !!s.validationRequired,
      mode:     s.validationTrainedAt ? (s.validationMode ?? 'single') : 'none',
      ...(s.validationTrainedAt && { trainedAt: s.validationTrainedAt }),
      ...(s.validationTrainedAt && (s.validationMode ?? 'single') === 'single' && {
        referenceUrl: `/guides/${guide.id}/steps/${s.id}/validation-ref.jpg`,
        verdictUrl:   `/guides/${guide.id}/steps/${s.id}/validate`,
      }),
    }));

  return {
    schema: BUNDLE_SCHEMA,
    generatedAt: (look.now ?? (() => new Date().toISOString()))(),
    guide,
    steps: ordered,
    models,
    anchor: {
      id: guide.anchorId,
      assetId: anchor?.assetId ?? '',
      anchorType: anchor?.anchorType ?? 'QR',
      ...(anchor?.configId && { configId: anchor.configId }),
      ...(anchor?.originSource && { originSource: anchor.originSource }),
      frames,
    },
    validation,
    playback: {
      animationSpeed: guide.assembly?.animationSpeed ?? 0.5,
      conventions: {
        units: 'm', up: 'Y', handedness: 'right', rotation: 'axis-angle-xyz-rad', quaternion: 'xyzw',
        matrices: 'column-major-16', timeline: 'cumulative-last-write-wins',
        contract: '/catalog/doc/guide-bundle',
      },
    },
    links: {
      self:        `/guides/${guide.id}/bundle`,
      guide:       `/guides/${guide.id}`,
      steps:       `/guides/${guide.id}/steps`,
      liveSession: `/guide-sessions/live`,
    },
  };
}
