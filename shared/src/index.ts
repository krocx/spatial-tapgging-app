// ============================================================
// SIB Canonical Types — v1.0
// Source of truth: /docs/schemas.md
// All clients and adapters MUST use these types.
// ============================================================

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
   * Physical width of the printed QR code in centimetres.
   * Stored once at anchor creation so every subsequent QR generation —
   * in-app and in the portal — uses the same size, producing the same QR pixels.
   * ARKit uses this to compute accurate 6DOF pose from the QR corners.
   * Default: 10.0 cm.
   */
  qrSizeCm?: number;
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
}

// ============================================================
// Tag — semantic label attached to an anchor
// ============================================================

export interface Tag {
  id: string;
  anchorId: string;
  type: TagType;
  label: string;
  expectedOutcome: string;
  checkDescription?: string;   // optional human-readable check instruction
  order?: number;              // optional step order within an anchor
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
  /** Deep-merged into tag.metadata — existing keys are preserved. */
  metadata?: Record<string, unknown>;
}

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

export interface Session {
  id: string;
  userId: string;
  assetId: string;
  startTime: string;        // ISO 8601
  endTime?: string;         // set on close
  observations: Observation[];
  completedSteps: string[]; // stepIds
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

export interface PassState {
  id: string;
  tagId: string;
  anchorId: string;
  assetId: string;
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
