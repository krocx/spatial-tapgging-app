// ============================================================
// SIB Canonical Types — v1.0
// Source of truth: /docs/schemas.md
// All clients and adapters MUST use these types.
// ============================================================

// --- Anchor Types ---

/**
 * Discriminates between the two anchor placement mechanisms:
 *   QR       — classic flow: Author prints a QR code, scans it to place the anchor.
 *   LOC_TAG  — Gemba audit walk: Author taps any surface to place the anchor;
 *              an ARWorldMap is saved so Operators can re-localize without a QR.
 * Defaults to 'QR' when absent for backward-compatibility with existing anchors.
 */
export type AnchorType = 'QR' | 'LOC_TAG' | 'LOTO';

// --- Defect Categories (Loc-Tag / Gemba audit walk) ---

export type DefectCategory =
  | '6C'
  | 'COSMETIC'
  | 'CABLE_ROUTING'
  | 'PART_MISSING'
  | 'LOOSE_COMPONENTS'
  | 'SWAPPED_PARTS'
  | 'SAFETY_HAZARD'
  | 'CONTAMINATION'
  | 'WARNING'
  | 'OTHERS';

export type LocTagCompletionStatus = 'RESOLVED' | 'STILL_PRESENT' | 'ESCALATED';

// --- Coordinate Systems ---

export type CoordinateSystem =
  | 'PLANT_FRAME'
  | 'ASSET_FRAME'
  | 'LOCAL_DEVICE_FRAME';

// --- Defect Ontology ---

export type DefectType =
  | 'DEFECT_TYPE_SCRATCH'
  | 'DEFECT_TYPE_DENT'
  | 'DEFECT_TYPE_BURN_MARK';

export type StatusCode = 'STATUS_OK' | 'STATUS_NG';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

// --- Tag Types ---

export type TagType =
  | 'INSPECTION_POINT'
  | 'DEFECT'
  | 'INSTRUCTION'
  | 'WARNING'
  | 'MEASUREMENT'
  // Phase 2 — cleanroom / industrial inspection
  | 'PRESENCE_CHECK'
  | 'LANGUAGE_CHECK'
  | 'ROUTING_CHECK'
  | 'CONFIGURATION_CHECK'
  | 'PART_CHECK';

// --- Spatial Primitives ---

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

// ============================================================
// Anchor — stable spatial reference point on an asset
// ============================================================

export interface Anchor {
  id: string;
  assetId: string;
  coordinateSystem: CoordinateSystem;
  position: Vector3;
  rotation: Quaternion;
  metadata: Record<string, unknown>;
  /**
   * Phase 3: base64-encoded AES-256-GCM key for this anchor.
   * Generated on-device when the anchor is created; stored in SIB so that
   * any authorised device can retrieve the key and generate the full QR code
   * (with the key embedded) without needing the Author's Keychain.
   * The physical printed QR embeds this key from day one — it never changes.
   * Optional so legacy anchors without keys remain backward-compatible.
   */
  encryptionKey?: string;
  /**
   * Loc-Tag anchors are placed by surface hit-test rather than QR scan.
   * Omitted for all existing anchors — treat absent as 'QR'.
   */
  anchorType?: AnchorType;
  /**
   * Physical width of the printed QR code in centimetres.
   * Stored once at anchor creation so every subsequent QR generation —
   * in-app and in the portal — uses the same size, producing the same QR pixels.
   * ARKit uses this to compute accurate 6DOF pose from the QR corners.
   * Default: 10.0 cm.
   */
  qrSizeCm?: number;
  /**
   * The display name of the user who created this anchor.
   * Set from the device's Author Name setting at creation time.
   * Absent on anchors created before this field was introduced (treat as shared/legacy).
   */
  createdBy?: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface CreateAnchorRequest {
  id?: string;
  assetId: string;
  coordinateSystem: CoordinateSystem;
  position: Vector3;
  rotation: Quaternion;
  metadata: Record<string, unknown>;
  /** Phase 3: encryption key generated at anchor creation time. */
  encryptionKey?: string;
  /** Physical QR print size in cm — locked at creation. Default: 10.0. */
  qrSizeCm?: number;
  /** Loc-Tag anchors omit the QR flow entirely. Default: 'QR'. */
  anchorType?: AnchorType;
  /** Author name at creation time — used for per-user anchor filtering in the directory. */
  createdBy?: string;
}

// ============================================================
// Tag — semantic label attached to an anchor
// ============================================================

/**
 * Normalised region-of-interest within the captured frame, expressed as
 * fractions (0.0–1.0) of image width/height, origin at top-left.
 * Optional. When absent, validation considers the entire frame (today's
 * behaviour, unchanged). When present, both training references and live
 * frames are cropped to this rectangle before similarity scoring — this is
 * what lets a tag focus on the specific feature being inspected (a cable,
 * a switch, a valve) instead of the whole scene.
 */
export interface RegionOfInterest {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tag {
  id: string;
  anchorId: string;
  type: TagType;
  label: string;
  expectedOutcome: string;
  checkDescription?: string;   // optional human-readable check instruction
  order?: number;              // optional step order within an anchor
  /** Optional inspection-region crop — see RegionOfInterest. Backward-compatible. */
  roi?: RegionOfInterest;
  /**
   * Tag Groups — optional grouping of tags under a named Inspection Set.
   * Absent on legacy tags (treat as ungrouped). When set, this tag belongs
   * to the TagGroup with this id.
   */
  groupId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type CreateTagRequest = Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>;

/** Partial update — only supplied fields are written. */
export interface UpdateTagRequest {
  label?: string;
  expectedOutcome?: string;
  checkDescription?: string;
  order?: number;
  /** Optional inspection-region crop. Set to null to clear an existing ROI. */
  roi?: RegionOfInterest | null;
  /** Deep-merged into tag.metadata — existing keys are preserved. */
  metadata?: Record<string, unknown>;
}

// ============================================================
// TagGroup — named Inspection Set grouping Tags under an Anchor
// ============================================================

/**
 * A TagGroup is a named collection of Tags attached to one Anchor.
 * Mirrors the ARGuide pattern: Author creates groups, assigns Tags to them,
 * Operator selects a group to inspect and enters AR with only those tags.
 * An Anchor can have multiple TagGroups (e.g. "Chamber Inspection", "Gas Line Check").
 */
export interface TagGroup {
  id:          string;
  anchorId:    string;
  name:        string;
  description?: string;
  createdBy?:  string;    // authorName at creation time
  createdAt:   string;
  updatedAt:   string;
}

export type CreateTagGroupRequest = {
  anchorId:    string;
  name:        string;
  description?: string;
  createdBy?:  string;
};

export type UpdateTagGroupRequest = {
  name?:        string;
  description?: string;
};

// ============================================================
// Model3D — 3D asset library for AR Guide step ghost overlays
// ============================================================

/**
 * Raw file format supplied by the Author on upload.
 * 'glb' / 'gltf' / 'usdz' — AR-ready, stored as-is and marked ready immediately.
 * 'obj' / 'fbx'            — Common interchange; server converts to GLB via Blender.
 * 'step' / 'iges'          — CAD formats; server converts via Blender + CAD importer
 *                            (requires Blender with CAD addon on the server host).
 *                            If Blender is unavailable the record is marked 'failed'
 *                            with a helptext asking the Author to pre-export to GLB.
 */
export type ModelFormat = 'glb' | 'gltf' | 'usdz' | 'obj' | 'fbx' | 'step' | 'iges';

/** Server-side processing state for the 3D model. */
export type ModelStatus = 'uploading' | 'processing' | 'ready' | 'failed';

/**
 * A 3D model in the global asset library.
 * Authors upload via the web portal; the server converts to GLB (canonical format)
 * and optionally stores the original USDZ for direct iOS use.
 * Multiple GuideSteps can reference the same model via modelId.
 *
 * Global library (v2): models are no longer anchored to a single anchor.
 *   anchorId  — legacy field, still set on models uploaded before the global library
 *   anchorIds — the anchor kit: list of anchor IDs that have this model assigned;
 *               GET /models?anchorId=xxx returns models where anchorIds.includes(anchorId)
 */
export interface Model3D {
  id:               string;
  anchorId?:        string;            // legacy — preserved for backward compatibility
  anchorIds?:       string[];          // kit membership: anchors this model is assigned to
  name:             string;             // display name (editable)
  originalFormat:   ModelFormat;
  originalFilename: string;
  fileSizeBytes:    number;
  status:           ModelStatus;
  conversionError?: string;             // populated on failure
  hasGLB:           boolean;            // true once .glb file is available
  hasUSDZ:          boolean;            // true once a .usdz file is available (browser-converted or original USDZ)
  usdzStatus?:      'pending' | 'ready' | 'failed'; // USDZ conversion state; absent on legacy records → infer from hasUSDZ
  category?:        string;             // 'general' = visible to all anchors; other values are organizational labels
  defaultScale?:    number;             // Author-saved default scale (pre-fills model picker on iOS)
  uploadedBy?:      string;
  createdAt:        string;
  updatedAt:        string;
}

export type UpdateModel3DRequest = {
  name?:         string;
  defaultScale?: number;    // persist the scale chosen in the portal 3D preview viewer
  category?:     string;    // 'general' | other organizational label
};

// ============================================================
// Observation — normalised output from any AI perception model
// ============================================================

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Observation {
  id: string;
  source: string;           // adapter name, e.g. "sodavision-adapter"
  timestamp: string;        // ISO 8601
  imageId: string;
  assetId: string;
  anchorId: string;
  tagId: string;
  label: string;            // mapped to SIB ontology
  confidence: number;       // 0.0 – 1.0
  severity: Severity;
  location: BoundingBox;
  status?: StatusCode;
  rawPayload: Record<string, unknown>; // original model output preserved
}

// ============================================================
// Procedure — ordered graph of inspection steps
// ============================================================

export interface ProcedureStep {
  stepId: string;
  tagId: string;
  order: number;
  condition?: string;       // optional guard expression
}

export interface Procedure {
  id: string;
  assetId: string;
  name: string;
  steps: ProcedureStep[];
  createdAt: string;
  updatedAt: string;
}

export type CreateProcedureRequest = Omit<Procedure, 'id' | 'createdAt' | 'updatedAt'>;

// ============================================================
// Session — a single technician (or cobot) run
// ============================================================

// ── Phase 4: Inspection reporting types ──────────────────────

export type TagInspectionStatus = 'PASS' | 'FAIL' | 'NOT_VISITED';

export interface TagInspectionRecord {
  tagId:           string;
  tagLabel:        string;
  status:          TagInspectionStatus;
  note?:           string;
  /** Filename on SIB evidence store: AnchorID_TagID_YYYYMMDD_HHMMSS.jpg */
  imagePath?:      string;
  /** True when this tag was FAIL during the session but corrected to PASS. */
  fixedInSession?: boolean;
}

export interface SubmitReportRequest {
  ownerName:       string;
  anchorId:        string;
  anchorName:      string;    // assetId — human-readable label
  endTime:         string;    // ISO 8601
  durationSeconds: number;
  tagRecords:      TagInspectionRecord[];
  overallStatus:   TagInspectionStatus;
}

export interface UploadEvidenceRequest {
  anchorId:    string;
  imageBase64: string;
  mimeType:    'image/jpeg';
  capturedAt:  string;        // ISO 8601
}

export interface EvidenceUploadResponse {
  /** Filename on SIB server: AnchorID_TagID_YYYYMMDD_HHMMSS.jpg */
  imagePath: string;
}

// ── End Phase 4 types ─────────────────────────────────────────

export interface Session {
  id: string;
  userId: string;
  assetId: string;
  startTime: string;        // ISO 8601
  endTime?: string;         // set on close
  observations: Observation[];
  completedSteps: string[]; // stepIds
  // ── Phase 4: Inspection report fields (set via PATCH /sessions/:id/report) ──
  ownerName?:       string;
  anchorId?:        string;
  anchorName?:      string;
  durationSeconds?: number;
  tagRecords?:      TagInspectionRecord[];
  overallStatus?:   TagInspectionStatus;
  // ── end report fields ────────────────────────────────────────────────────────
  createdAt: string;
  updatedAt: string;
}

export type CreateSessionRequest = Pick<Session, 'userId' | 'assetId'>;

// ============================================================
// API Response envelope
// ============================================================

export interface ApiResponse<T> {
  data: T;
  timestamp: string;
}

export interface ApiError {
  error: string;
  timestamp: string;
}

// ============================================================
// Author / Operator workflow types — v1.0
// ============================================================

// --- Pass-state training (Author mode) ---

export interface CameraPose {
  position: Vector3;
  rotation: Quaternion;
}

export interface PassStateImage {
  id: string;
  tagId: string;
  anchorId: string;
  assetId: string;
  imageBase64: string;         // JPEG, base64 encoded
  mimeType: 'image/jpeg';
  pose: CameraPose;            // camera pose when captured
  capturedAt: string;          // ISO 8601
}

/**
 * Which reference this set of images represents.
 * 'PASS' (the default, and the only kind that existed before this field was
 * added) trains the "correct" appearance. 'FAIL' is optional — an Author may
 * additionally train what the *wrong* state looks like (cable unplugged,
 * valve closed, switch off, part misoriented, etc.). When a tag has no FAIL
 * state trained, validation falls back to today's single-reference
 * absolute-threshold behaviour, unchanged.
 */
export type PassStateKind = 'PASS' | 'FAIL';

export interface PassState {
  id: string;
  tagId: string;
  anchorId: string;
  assetId: string;
  /** Defaults to 'PASS' when omitted, for backward compatibility. */
  state?: PassStateKind;
  images: PassStateImage[];    // multi-viewpoint samples from honeycomb
  createdAt: string;
  updatedAt: string;
}

export type CreatePassStateRequest = Omit<PassState, 'id' | 'createdAt' | 'updatedAt'>;

// --- Validation (Operator mode) ---

export type ValidationStatus = 'PASS' | 'FAIL' | 'PENDING';

export type AnchorStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'PENDING';

export interface ValidationResult {
  id: string;
  tagId: string;
  anchorId: string;
  assetId: string;
  sessionId: string;
  status: ValidationStatus;
  confidence: number;          // 0.0 – 1.0
  evidenceImageBase64?: string; // optional capture on FAIL
  evaluatedAt: string;         // ISO 8601
}

export interface ValidateRequest {
  tagId: string;
  anchorId: string;
  assetId: string;
  sessionId: string;
  imageBase64: string;
  mimeType: 'image/jpeg';
}

// Batch validation — all tags for an anchor in a single call (Operator mode)

export interface BatchValidateRequest {
  anchorId: string;
  assetId: string;
  sessionId: string;
  imageBase64: string;
  mimeType: 'image/jpeg';
  /** Override the global PASS_THRESHOLD env var (0.0–1.0, default 0.60). */
  threshold?: number;
  /** When set, only the listed tagIds are evaluated (used for failed-only re-inspection). */
  tagIds?: string[];
  /**
   * Phase 2.5: base64-encoded AES-256 symmetric key from the QR code.
   * When present the SIB decrypts stored pass-state images in-memory before
   * comparison. Plaintext is never re-persisted.
   */
  encryptionKey?: string;
}

export interface TagValidationSummary {
  tagId: string;
  tagLabel: string;
  tagType: TagType;
  status: ValidationStatus;
  confidence: number;         // 0.0 – 1.0
  /**
   * #66: distinguishes a genuine visual mismatch from a pipeline failure
   * (e.g. AES decrypt error on the stored pass-state images) that would
   * otherwise also show up as an ordinary ~0% confidence FAIL with no way
   * for the Operator to tell the two apart. Omitted for normal results.
   */
  errorReason?: 'DECRYPT_FAILED';
}

export interface AnchorValidationResult {
  id: string;
  anchorId: string;
  assetId: string;
  sessionId: string;
  status: AnchorStatus;
  passCount: number;
  failCount: number;
  totalCount: number;
  tagResults: TagValidationSummary[];
  evaluatedAt: string;        // ISO 8601
  /**
   * #67: set when the request had no encryptionKey at all (Operator scanned
   * the original physical QR instead of the app-generated one). Previously
   * this was only a server console.warn — every tag would silently show
   * ~0% confidence with no indication that the cause was a missing key
   * rather than an actual mismatch. Omitted when a key was supplied.
   */
  warning?: string;
}

// --- QR anchor context ---

export interface QRAnchorContext {
  assetId: string;
  anchorId: string;
  /**
   * Phase 2.5: base64-encoded AES-256-GCM symmetric key for this anchor.
   * Generated by the Author device when an anchor is first created.
   * Embedded in the QR payload so any device that scans the QR gets the key.
   * Never transmitted to or stored on the SIB server.
   * Optional so unencrypted anchors stay backwards-compatible.
   */
  encryptionKey?: string;
  /**
   * Camera orientation (device quaternion) at the exact moment the QR code
   * was successfully decoded.  Set by main.ts after scanQR() returns and used
   * by Author / Operator mode to store / reconstruct QR-relative tag positions.
   * Optional so the type stays backwards-compatible.
   */
  scanQuaternion?: Quaternion;
}

// ============================================================
// Loc-Tag — Phase 2 Gemba audit walk types
// ============================================================

/**
 * A location-tagged defect or observation placed by tapping a surface
 * during an Author's Gemba audit walk. Unlike regular Tags, LocTags are
 * not tied to a QR anchor — the spatial reference is an ARWorldMap.
 */
export interface LocTag {
  id: string;
  anchorId: string;
  title: string;
  description: string;
  severity?: Severity;
  defectCategory: DefectCategory;
  /** Free-text field populated when defectCategory === 'OTHERS'. */
  defectCategoryNote?: string;
  /** Filename of the reference photo stored in SIB evidence store. */
  referenceImagePath?: string;
  /** ARKit world-space position within the saved ARWorldMap. */
  position: Vector3;
  /** Author-defined visit order for Operator navigation. */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateLocTagRequest = Omit<LocTag, 'id' | 'referenceImagePath' | 'createdAt' | 'updatedAt'> & {
  /** Base64-encoded JPEG reference photo captured at tag placement. */
  referenceImageBase64?: string;
};

/**
 * Operator's completion record for a single LocTag.
 * Multiple completions are allowed (operator can revisit a tag on subsequent walks).
 */
export interface LocTagCompletion {
  id: string;
  locTagId: string;
  anchorId: string;
  operatorName: string;
  status: LocTagCompletionStatus;
  /** Filename of the completion photo stored in SIB evidence store. */
  completionImagePath?: string;
  note?: string;
  completedAt: string;
}

export type SubmitLocTagCompletionRequest =
  Omit<LocTagCompletion, 'id' | 'completionImagePath' | 'completedAt'> & {
    /** Base64-encoded JPEG completion photo. */
    completionImageBase64?: string;
  };

/** Summary of a LocTag's latest completion status — used in session reports. */
export interface LocTagSummary {
  locTagId:   string;
  title:      string;
  order:      number;
  latestStatus?: LocTagCompletionStatus;
  completedAt?:  string;
}

// ============================================================
// AR OMS — Phase 1: Guided work instruction types
// ============================================================

/**
 * The media type of a step's attached asset.
 * 'image' — JPEG photo (MVP).
 * 'video' — MP4 short clip (Phase 2).
 * 'glb'   — 3D model (Phase 2).
 */
export type GuideStepMediaType = 'image' | 'video' | 'glb';

/**
 * A single step within an AR Guide.
 * sequenceNumber is 1-based and determines display order.
 * ttsText defaults to `text` when absent (synthesised on-device).
 * mediaPath is the filename on the SIB step-image store — absent when no media is attached.
 * completionRequired: when true the Operator must tap the checkmark before advancing.
 */
export interface GuideStep {
  id:                 string;
  guideId:            string;
  anchorId:           string;      // denormalised for efficient anchor-scoped queries
  sequenceNumber:     number;
  title?:             string;      // short display title (pill header + card header); falls back to "Step N"
  text:               string;      // description shown in the expanded floating panel
  ttsText?:           string;      // override for voice synthesis — defaults to text
  mediaType?:         GuideStepMediaType;
  mediaPath?:         string;      // filename on SIB step-image store
  /**
   * Reference link (video, PDF, SOP page — any http(s) URL). Shown as a
   * tappable "Reference" button on the AR step panel; opens on the device.
   * Deliberately a link rather than embedded media: the platform stores no
   * copy, and the target can be any format the phone's browser can open.
   */
  linkUrl?:           string;
  completionRequired: boolean;     // defaults to true
  // Phase 2: spatial placement
  posX?:              number;      // ARKit world-space X (metres, relative to saved ARWorldMap)
  posY?:              number;
  posZ?:              number;
  isPlaced:           boolean;     // true once Author has placed the pin in AR
  positionSource?:    'tap' | 'cad';  // forward-compat hook: 'tap' = Author placed; 'cad' = imported
  // 3D model ghost overlay (Phase 2 — Model3D library)
  modelId?:           string;      // Model3D.id from anchor asset library
  modelScale?:        number;      // uniform scale factor applied to the model (default 1.0)
  modelOpacity?:      number;      // ghost overlay opacity 0.0–1.0 (default 0.45)
  modelOffsetX?:      number;      // metres offset from step world position (X axis)
  modelOffsetY?:      number;
  modelOffsetZ?:      number;
  modelRotationY?:    number;      // Y-axis rotation in radians (Author-placed via AR placement UI)
  // Conditional task graph (Step 2 of AI-readiness) — all optional for backward compat
  nextOnSuccess?:     string;      // step ID to navigate to on completion; nil → sequenceNumber+1
  nextOnFailure?:     string;      // step ID to navigate to on failure/retry; nil → stay on step
  precondition?:      string;      // step ID that must be completed before this step is reachable
  createdAt:          string;
  updatedAt:          string;
}

export type CreateGuideStepRequest = {
  sequenceNumber:      number;
  title?:              string;     // optional short title — falls back to "Step N" when absent
  text:                string;
  ttsText?:            string;
  mediaType?:          GuideStepMediaType;
  /** Base64-encoded JPEG — stored server-side; mediaPath is returned in the response. */
  mediaBase64?:        string;
  linkUrl?:            string;
  completionRequired?: boolean;    // defaults to true when absent
};

export type UpdateGuideStepRequest = {
  sequenceNumber?:     number;
  title?:              string;     // pass empty string to clear title (revert to "Step N" fallback)
  text?:               string;
  ttsText?:            string;
  completionRequired?: boolean;
  /** Pass null to clear an attached image. */
  mediaBase64?:        string | null;
  /** Pass null to clear the reference link. */
  linkUrl?:            string | null;
  // Phase 2: spatial placement
  posX?:               number;
  posY?:               number;
  posZ?:               number;
  isPlaced?:           boolean;
  positionSource?:     'tap' | 'cad';
  // 3D model ghost overlay
  modelId?:            string | null;   // null clears the assigned model
  modelScale?:         number;
  modelOpacity?:       number;
  modelOffsetX?:       number;
  modelOffsetY?:       number;
  modelOffsetZ?:       number;
  modelRotationY?:     number;     // Y-axis rotation in radians
  // Conditional task graph — null clears, undefined keeps existing
  nextOnSuccess?:      string | null;
  nextOnFailure?:      string | null;
  precondition?:       string | null;
};

/**
 * A Guide is a named, ordered collection of steps attached to one Anchor.
 * published: false → draft (Author-visible only); true → live (Operators can run it).
 * An Anchor can have multiple Guides (e.g. "Startup Procedure", "Fault Recovery").
 */
export interface Guide {
  id:          string;
  anchorId:    string;
  name:        string;
  description: string;
  published:   boolean;
  createdBy:   string;    // authorName at creation time
  /**
   * Per-user sharing (UAM): normalised emails of the technicians this guide
   * is shared with. Absent/empty = visible to ALL technicians (backward
   * compatible). Non-empty = visible only to the listed users. Engineers,
   * Managers and Owners always see every guide.
   */
  sharedWith?: string[];
  createdAt:   string;
  updatedAt:   string;
}

export type CreateGuideRequest = {
  anchorId:     string;
  name:         string;
  description?: string;
  createdBy:    string;
};

export type UpdateGuideRequest = {
  name?:        string;
  description?: string;
  published?:   boolean;
  /** Move the guide (and all its steps) to another anchor. Spatial placement
   *  is cleared — positions belong to the old anchor's world map — and a
   *  published guide is unpublished until re-placed. */
  anchorId?:    string;
  /** Replace the sharing list (see Guide.sharedWith). [] = all technicians.
   *  Emails must exist in the UAM allow-list. Requires Engineer role or above. */
  sharedWith?:  string[];
};

/**
 * Completion record for a single step within a GuideSession.
 *
 * evidencePhotoBase64 — iOS sends an optional JPEG encoded as base64. The server
 * stores it to disk and replaces this field with evidencePhotoPath in the stored
 * record.  Both fields are optional so sessions without evidence decode cleanly.
 *
 * enteredAt — when the Operator first saw this step (set on step:entered event).
 * Absent on sessions recorded before this field was added; consumers should treat
 * it as optional.
 */
export interface GuideStepCompletion {
  stepId:               string;
  enteredAt?:           string;   // ISO 8601 — when step first shown to Operator
  completedAt:          string;   // ISO 8601
  durationSeconds:      number;   // time from step entry to checkmark tap
  evidencePhotoBase64?: string;   // request only — base64 JPEG; server strips on receipt
  evidencePhotoPath?:   string;   // stored only — relative path set by server after save
}

/**
 * A GuideSession records one Operator's run through a Guide.
 * Created atomically at sign-off (not opened then closed — the entire session
 * is submitted in a single POST once the Operator taps Sign & Submit).
 */
export interface GuideSession {
  id:              string;
  guideId:         string;
  anchorId:        string;
  guideName:       string;    // snapshot of guide name at session time
  anchorName:      string;    // snapshot of anchor assetId at session time
  signedOffBy:     string;    // operatorName — from AppSettings.authorName on the device
  startedAt:       string;    // when the AR session began
  completedAt:     string;    // when sign-off was tapped
  durationSeconds: number;
  stepCompletions: GuideStepCompletion[];
  createdAt:       string;
  updatedAt:       string;
}

export type CreateGuideSessionRequest = {
  guideId:         string;
  anchorId:        string;
  guideName:       string;
  anchorName:      string;
  signedOffBy:     string;
  startedAt:       string;
  completedAt:     string;
  durationSeconds: number;
  stepCompletions: GuideStepCompletion[];
  /** When the Operator opened the guide via the live session stream, this links
   *  the sign-off record to the in-flight LiveGuideSession for full telemetry. */
  liveSessionId?:  string;
};

// ============================================================
// Live Guide Session — real-time step telemetry (AI readiness, Phase 2)
// ============================================================

/**
 * Event types emitted by the iOS app during an active guide session.
 * The server fans these out over SSE to any registered observer (AI agent, dashboard).
 *
 *   session:started   — Operator opened the guide; AR session initialising.
 *   step:entered      — Operator navigated to a step (first time or revisit).
 *   step:completed    — Operator tapped the checkmark on a step.
 *   step:retried      — Operator tapped "Previous" to go back to a step.
 *   perception:result — Live-frame validation result (future: fed by Operator mode).
 *   session:submitted — Sign-off submitted; links to GuideSession id.
 */
export type GuideSessionEventType =
  | 'session:started'
  | 'step:entered'
  | 'step:completed'
  | 'step:retried'
  | 'step:failed'      // Operator marked the step failed and took the recovery branch
  | 'step:stalled'
  | 'perception:result'
  | 'session:submitted';

export interface GuideSessionEvent {
  id:               string;                 // uuidv4 — unique per event
  liveSessionId:    string;
  type:             GuideSessionEventType;
  ts:               string;                 // ISO 8601
  stepId?:          string;                 // present for step:* events
  stepIndex?:       number;                 // 0-based index in sorted step list
  durationSeconds?: number;                 // step:completed — time on this step
  payload?:         Record<string, unknown>; // event-specific extras (e.g. perception result)
}

/**
 * An in-flight guide session tracked in server memory while the Operator is active.
 * Created at session:started, closed and optionally linked at session:submitted.
 *
 * Not persisted to disk — intentionally ephemeral. The linked GuideSession
 * (created at sign-off) is the durable record; LiveGuideSession carries the
 * real-time event log that makes AI intervention possible during the session.
 */
export interface LiveGuideSession {
  id:               string;     // liveSessionId
  guideId:          string;
  anchorId:         string;
  guideName:        string;
  anchorName:       string;
  operatorName:     string;
  startedAt:        string;     // ISO 8601
  currentStepIndex: number;     // last known step index (0-based)
  events:           GuideSessionEvent[];
  linkedSessionId?: string;     // set when GuideSession sign-off POSTs with liveSessionId
  closedAt?:        string;     // ISO 8601 — set on session:submitted
}

export interface OpenLiveSessionRequest {
  guideId:      string;
  anchorId:     string;
  guideName:    string;
  anchorName:   string;
  operatorName: string;
}

export interface PushGuideSessionEventRequest {
  type:             GuideSessionEventType;
  stepId?:          string;
  stepIndex?:       number;
  durationSeconds?: number;
  payload?:         Record<string, unknown>;
}

/**
 * AIHint — a guidance intervention generated by an AIGuideAdapter and
 * delivered to the iOS Operator via GET /guide-sessions/live/:id/hints.
 *
 * Consumed once: the endpoint drains the queue so hints are not re-shown.
 */
export interface AIHint {
  id:             string;   // uuidv4
  liveSessionId:  string;
  stepId?:        string;   // step the hint pertains to
  text:           string;   // human-readable guidance shown on iOS
  /** Optional navigation action — follows nextOnFailure branch if set. */
  action?:        'navigate' | 'none';
  targetStepId?:  string;   // step to navigate to when action === 'navigate'
  /** Why the adapter fired: drives assist UX (stall auto-expands the card;
   *  retry stays as a quiet chip). Optional for backward compatibility. */
  trigger?:       'stall' | 'retry';
  ts:             string;   // ISO 8601
}

// ============================================================
// Instructions Import Tool — adapter-based guide import
// ============================================================

/**
 * A single step in an imported guide.
 *
 * Graph links (nextOnSuccess, nextOnFailure, precondition) are expressed as
 * 1-based sequence numbers rather than UUIDs — the server resolves them to
 * real step IDs after all steps have been created.
 *
 * imageUrl, if provided, is downloaded at import time and stored in the SIB
 * step-image directory (same path as portal-uploaded images). The guide works
 * offline once imported.
 */
export interface ImportedGuideStep {
  sequenceNumber:       number;
  title?:               string;
  text:                 string;
  ttsText?:             string;
  /** URL of the reference image — downloaded and stored locally at import time. */
  imageUrl?:            string;
  /**
   * Filename in the SERVER-LOCAL designer image store (uploaded from the
   * Procedure Designer via POST /mindmap/step-images). Copied — not
   * downloaded — into the guide step-image store at ingest. Mutually
   * exclusive with imageUrl; imageFile wins when both are present.
   */
  imageFile?:           string;
  /** Reference link (any http(s) URL) — carried through to GuideStep.linkUrl. */
  linkUrl?:             string;
  completionRequired?:  boolean;   // defaults to true
  // 3D ghost overlay ASSIGNMENT (which model, how big, how transparent).
  // Deliberately excludes offsets/rotation: those are AR placement, owned by
  // the device, and survive re-sync — see applyImportedGuide.
  modelId?:             string;
  modelScale?:          number;
  modelOpacity?:        number;
  // Conditional task graph — expressed as sequence numbers; server resolves to UUIDs
  nextOnSuccessSeq?:    number;
  nextOnFailureSeq?:    number;
  preconditionSeq?:     number;
}

/**
 * A complete guide ready to be imported into SIB.
 * Produced by InstructionsSourceAdapters (ManualJsonAdapter for testing,
 * MESAdapter for production).
 */
export interface ImportedGuide {
  name:         string;
  description?: string;
  steps:        ImportedGuideStep[];
}

/**
 * Request body for POST /guides/import.
 * sourceType defaults to 'manual' — pass 'mes' when routing through the MES adapter.
 */
export interface ImportGuideRequest {
  anchorId:     string;
  createdBy:    string;
  sourceType?:  'manual' | 'mes';
  /** Full ImportedGuide payload — passed through to the active adapter. */
  payload:      ImportedGuide;
}

/**
 * Response from POST /guides/import.
 * imageErrors lists any imageUrl values that failed to download — the guide
 * and its steps are still created; affected steps simply have no mediaPath.
 */
export interface ImportGuideResult {
  guide:        Guide;
  steps:        GuideStep[];
  imageErrors:  string[];
}

// ============================================================
// iLOTO — spatial Lockout/Tagout (see docs/ILOTO.md)
// ============================================================
//
// An anchor with anchorType 'LOTO' is one control panel. Authored LotoPoints
// mark its circuit breakers (Safe Off, yellow) and switches (LOTO, red).
// Every apply/remove is an APPEND-ONLY LotoEvent — status is always derived
// from the event log on read, never stored or edited. The app is the record
// and verification aid; the physical lock is the safety control.

/** 'safeoff' = out-of-service yellow lock on a breaker; 'loto' = personal
 *  danger red lock on a switch. Site semantics per docs/ILOTO.md §2. */
export type LotoPointKind = 'safeoff' | 'loto';

/**
 * An authored isolation point on a control panel. Placement follows the
 * platform invariant: position is DEVICE-owned (set by the author standing at
 * the panel); the lock 3D asset is an assignment from the Model3D library.
 * Operators act only on authored points — ad-hoc points would destroy audit
 * integrity.
 */
export interface LotoPoint {
  id:          string;
  anchorId:    string;
  kind:        LotoPointKind;
  label:       string;        // e.g. "CB-3 · Main spindle"
  circuitId?:  string;        // free-form circuit reference for the LOTO map
  position:    Vector3;       // ARKit world space within the anchor's world map
  /**
   * 3D asset slots — up to LOTO_MAX_MODELS per point (e.g. a lock, a tag,
   * and a hasp). Each slot carries its own device-owned placement; the
   * server clears a slot's placement when its modelId changes (placement
   * belongs to a shape, not a slot).
   */
  models?:     LotoPointModel[];
  // ── Legacy single-model fields (pre-slots builds) ─────────────────────────
  // Honoured as an implicit first slot when `models` is absent; new writes
  // should use `models`. Kept so older app builds keep working.
  modelId?:    string;
  modelScale?: number;
  modelOffsetX?:   number;
  modelOffsetY?:   number;
  modelOffsetZ?:   number;
  modelRotationY?: number;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
}

/** One 3D asset on a point: assignment (which model, how big) + device-owned
 *  AR placement. slotId is stable across edits so placement survives
 *  reordering and other slots' changes. */
export interface LotoPointModel {
  slotId:          string;
  modelId:         string;
  modelScale?:     number;
  modelOffsetX?:   number;
  modelOffsetY?:   number;
  modelOffsetZ?:   number;
  modelRotationY?: number;
}

// NOTE: the max-slots limit (3) is a VALUE and therefore deliberately NOT
// exported from this types-only package (see the runtime-values rule at the
// bottom of this file). It lives as LOTO_MAX_MODELS in sib/src/loto/loto-core.ts
// and iOS LotoModels.swift.

export type CreateLotoPointRequest =
  Omit<LotoPoint, 'id' | 'createdAt' | 'updatedAt'>;

export type UpdateLotoPointRequest = Partial<
  Pick<LotoPoint, 'label' | 'circuitId' | 'position' | 'models'
                | 'modelId' | 'modelScale'
                | 'modelOffsetX' | 'modelOffsetY' | 'modelOffsetZ' | 'modelRotationY'>>;

/**
 * Event types. 'override-remove' is the OSHA 1910.147 exception procedure —
 * removing someone else's lock under documented conditions. It exists as a
 * DISTINCT type so audits surface overrides instantly; it is never a fallback
 * the UI reaches silently.
 */
export type LotoEventType = 'apply' | 'remove' | 'override-remove';

/** Supervisor override record — all three confirmations are the OSHA
 *  exception conditions and must be true for the server to accept. */
export interface LotoOverride {
  supervisorName:          string;
  reason:                  string;
  verifiedAbsent:          boolean;   // verified the authorized employee is not at the facility
  contactAttempted:        boolean;   // reasonable effort made to contact them
  willInformBeforeReturn:  boolean;   // they will be informed before resuming work
}

/**
 * One append-only audit record. The checklist snapshot stores exactly what
 * was confirmed at the time, so audits stay truthful even if checklist
 * definitions evolve later. There are no update or delete routes for events,
 * by design — including for admins.
 */
export interface LotoEvent {
  id:          string;
  anchorId:    string;
  pointId:     string;
  type:        LotoEventType;
  userId:      string;        // acting user (author-name identity)
  userName:    string;
  lockSerial?: string;
  /** Snapshot of the confirms shown for this flow, key → confirmed. */
  checklist:   Record<string, boolean>;
  /** Evidence photo filename in the SIB loto-photo store. */
  photoPath?:  string;
  override?:   LotoOverride;  // present iff type === 'override-remove'
  note?:       string;
  createdAt:   string;
}

export type CreateLotoEventRequest =
  Omit<LotoEvent, 'id' | 'photoPath' | 'createdAt'> & {
    /** Base64 JPEG evidence photo (required for apply events). */
    photoBase64?: string;
  };

/** Derived on read from the event log — never stored. */
export interface LotoPointStatus {
  point:       LotoPoint;
  state:       'clear' | 'locked';
  /** Present when locked. */
  lockedBy?:   string;        // userId
  lockedByName?: string;
  lockedAt?:   string;
  lockSerial?: string;
  lastEventId?: string;
}

/** Panel-level aggregation for the hub status banner. */
export interface LotoAnchorStatus {
  anchorId:      string;
  points:        LotoPointStatus[];
  lotoActive:    number;      // red locks currently applied
  safeOffActive: number;      // yellow locks currently applied
  lastEventAt?:  string;
}

/** One of the user's active locks, across all anchors (My LOTO). */
export interface MyLotoEntry {
  anchorId:   string;
  anchorName: string;
  status:     LotoPointStatus;
}

// ── AR LOTO map (electricity flow) ──────────────────────────────────────────

/**
 * One drawn flow line: an ordered polyline of world-space vertices (placed by
 * vertex-tap in AR, in the panel's QR-locked frame). `fedByPointId` links the
 * stroke to the Safe Off breaker that feeds it — the hook that makes the map
 * STATUS-AWARE: when that breaker is locked out, the stroke renders
 * de-energized.
 */
export interface LotoMapStroke {
  id:            string;
  points:        Vector3[];      // ≥ 2 vertices
  /** Circuit label shown on tap (matches LotoPoint.circuitId conventions). */
  circuitId?:    string;
  /** Safe Off breaker point feeding this line — drives de-energized rendering. */
  fedByPointId?: string;
}

/**
 * The panel's flow map. Versioned: every save creates version+1 (the previous
 * versions are kept — cheap, and EHS may ask "what did the map say then").
 * GET returns the highest version.
 */
export interface LotoMap {
  id:        string;
  anchorId:  string;
  version:   number;
  strokes:   LotoMapStroke[];
  createdBy: string;
  createdAt: string;
}

export interface SaveLotoMapRequest {
  anchorId:  string;
  strokes:   Array<Omit<LotoMapStroke, 'id'> & { id?: string }>;
  createdBy: string;
}

// ── Training / certification ────────────────────────────────────────────────

/** Question bank record as STORED (seeded from OSHA 1910.147; editable data,
 *  not code). GET /loto/quiz strips correctIndex + explanation — grading
 *  happens server-side only. */
export interface LotoQuizQuestion {
  id:           string;
  prompt:       string;
  choices:      string[];
  correctIndex: number;
  explanation:  string;
  createdAt:    string;
  updatedAt:    string;
}

/** What the client sees: a question with the answer withheld. */
export type LotoQuizQuestionPublic =
  Omit<LotoQuizQuestion, 'correctIndex' | 'explanation' | 'createdAt' | 'updatedAt'>;

export interface SubmitLotoQuizRequest {
  userId:   string;
  userName: string;
  /** questionId → chosen choice index. */
  answers:  Record<string, number>;
}

/** Per-question grading feedback returned after submission. */
export interface LotoQuizResultItem {
  questionId:  string;
  correct:     boolean;
  correctIndex: number;
  explanation: string;
}

/**
 * Certification record. Valid = passed && now < expiresAt. Issued only by the
 * server from a graded submission. Gates Safe Off and LOTO apply/remove.
 */
export interface LotoCertification {
  id:        string;
  userId:    string;
  userName:  string;
  score:     number;
  total:     number;
  passed:    boolean;
  issuedAt:  string;
  expiresAt: string;
}

export interface SubmitLotoQuizResult {
  certification: LotoCertification;
  results:       LotoQuizResultItem[];
}

// --- Roadmap Mind-Mapper (served at /roadmap, API at /mindmap/*) ---
export * from './mindmap.js';

// ── Platform version ─────────────────────────────────────────────────────────
// Lives in sib/src/version.ts, NOT here.
//
// This package's exports point at TypeScript SOURCE, so it is types-only at
// runtime: `import type` is always safe (erased at compile), and bundled
// clients are fine (vite compiles the source) — but a VALUE import from
// compiled server code crashes in production with ERR_MODULE_NOT_FOUND,
// because node cannot execute .ts. That is exactly how the first runtime
// value import ever added here took down a Render deploy.
//
// Rule: add types and interfaces to this package freely; add runtime values
// to the workspace that executes them.

// ─── UAM — User Access Management (RBAC ahead of SSO) ────────────────────────
// Pre-SSO identity: users are manually allow-listed by email + employee ID in
// the portal's UAM table. POST /uam/login identifies against that list and
// issues an HMAC-signed token. When corporate SSO (OIDC + HYPR) arrives, only
// the token-issuing step changes — every role check stays.

/** Role ladder, most → least privileged. */
export type UamRole = 'owner' | 'manager' | 'engineer' | 'technician';

export interface UamUser {
  id:         string;
  /** Normalised (lowercase, trimmed) — the identity key. */
  email:      string;
  employeeId: string;
  name:       string;
  role:       UamRole;
  createdAt:  string;
  updatedAt:  string;
}

export interface CreateUamUserRequest {
  email:      string;
  employeeId: string;
  name:       string;
  role:       UamRole;
}

/** Partial update — only supplied fields are written. */
export interface UpdateUamUserRequest {
  employeeId?: string;
  name?:       string;
  role?:       UamRole;
}

export interface UamLoginRequest {
  /** Omitted on the kiosk path — employeeId alone identifies the user. */
  email?:      string;
  /** Kiosk path sends ONLY this; when sent WITH email it must match. */
  employeeId?: string;
}

export interface UamLoginResponse {
  token: string;
  user:  UamUser;
}
