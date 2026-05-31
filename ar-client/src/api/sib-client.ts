// SIB API Client — thin HTTP client for the SIB backend.
// Never contains business logic. All requests use canonical types from @spatial/shared.

import type {
  Anchor,
  CreateAnchorRequest,
  Tag,
  CreateTagRequest,
  Session,
  CreateSessionRequest,
  Observation,
  PassState,
  CreatePassStateRequest,
  ValidationResult,
  ValidateRequest,
  ApiResponse,
} from '@spatial/shared';

// Empty string = same origin. Vite's proxy forwards /anchors, /tags, /sessions,
// /perception to SIB on localhost:3001 — so the iPhone never needs to reach the
// Mac's port 3001 directly. Set VITE_SIB_URL in .env only if SIB is on a
// separate host (e.g. staging server).
const BASE_URL = import.meta.env.VITE_SIB_URL ?? '';

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`SIB ${path} failed (${res.status}): ${err.error}`);
  }
  const envelope: ApiResponse<TRes> = await res.json();
  return envelope.data;
}

async function get<TRes>(path: string): Promise<TRes> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`SIB GET ${path} failed (${res.status}): ${err.error}`);
  }
  const envelope: ApiResponse<TRes> = await res.json();
  return envelope.data;
}

// --- Anchors ---

export async function createAnchor(req: CreateAnchorRequest): Promise<Anchor> {
  return post<CreateAnchorRequest, Anchor>('/anchors', req);
}

export async function getAnchor(id: string): Promise<Anchor> {
  return get<Anchor>(`/anchors/${id}`);
}

// --- Tags ---

export async function createTag(req: CreateTagRequest): Promise<Tag> {
  return post<CreateTagRequest, Tag>('/tags', req);
}

export async function getTag(id: string): Promise<Tag> {
  return get<Tag>(`/tags/${id}`);
}

/** Returns all tags for a given anchorId (used by Operator mode). */
export async function getTagsByAnchor(anchorId: string): Promise<Tag[]> {
  return get<Tag[]>(`/tags?anchorId=${encodeURIComponent(anchorId)}`);
}

// --- Sessions ---

export async function createSession(req: CreateSessionRequest): Promise<Session> {
  return post<CreateSessionRequest, Session>('/sessions', req);
}

export async function getSession(id: string): Promise<Session> {
  return get<Session>(`/sessions/${id}`);
}

export async function closeSession(id: string): Promise<Session> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/close`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`closeSession failed: ${res.statusText}`);
  const envelope: ApiResponse<Session> = await res.json();
  return envelope.data;
}

// --- Perception ---

export interface AnalyzeImageParams {
  imageBase64: string;
  mimeType: string;
  assetId: string;
  anchorId: string;
  tagId: string;
  sessionId: string;
  userId: string;
  adapter?: string;
}

export async function analyzeImage(params: AnalyzeImageParams): Promise<Observation[]> {
  return post<AnalyzeImageParams, Observation[]>('/perception/analyze-image', params);
}

// --- Training (Author mode) ---

export async function submitPassState(req: CreatePassStateRequest): Promise<PassState> {
  return post<CreatePassStateRequest, PassState>('/perception/train', req);
}

export async function getPassState(tagId: string): Promise<PassState> {
  return get<PassState>(`/perception/pass-state/${tagId}`);
}

// --- Validation (Operator mode) ---

export async function validateTag(req: ValidateRequest): Promise<ValidationResult> {
  return post<ValidateRequest, ValidationResult>('/perception/validate', req);
}
