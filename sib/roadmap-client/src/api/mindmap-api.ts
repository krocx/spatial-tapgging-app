// mindmap-api.ts — REST client for /mindmap/*. Mirrors the portal's auth model:
// GET /config reports whether SIB_API_KEY is enforced; the key is kept in
// localStorage and sent as X-API-Key on every request.

import type { Mindmap, MindmapSummary, MindmapVersion, SaveMindmapRequest, ApiResponse } from '@spatial/shared';

const API_KEY_STORAGE = 'sib-api-key';
const DRAFT_KEYS_STORAGE = 'roadmap-draft-keys';   // { [mapId]: draftKey }

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

// ── Draft keys (publish workflow, pre-RBAC) ────────────────────────────────
// The creator's browser receives each map's draft key exactly once (on
// creation) and keeps it here. Teammates add keys via "Unlock draft".

function readDraftKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEYS_STORAGE) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}

export function getDraftKey(mapId: string): string | undefined {
  return readDraftKeys()[mapId];
}

export function storeDraftKey(mapId: string, key: string): void {
  const all = readDraftKeys();
  all[mapId] = key;
  localStorage.setItem(DRAFT_KEYS_STORAGE, JSON.stringify(all));
}

export function forgetDraftKey(mapId: string): void {
  const all = readDraftKeys();
  delete all[mapId];
  localStorage.setItem(DRAFT_KEYS_STORAGE, JSON.stringify(all));
}

function draftKeysHeader(): string {
  return Object.entries(readDraftKeys()).map(([id, k]) => `${id}:${k}`).join(',');
}

export async function fetchAuthRequired(): Promise<boolean> {
  try {
    const res = await fetch('/config');
    const body = await res.json() as { authRequired?: boolean };
    return !!body.authRequired;
  } catch {
    return false;
  }
}

async function request<T>(path: string, init: RequestInit = {}, mapId?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;
  if (mapId) {
    const draftKey = getDraftKey(mapId);
    if (draftKey) headers['X-Draft-Key'] = draftKey;
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = ((await res.json()) as { error?: string }).error ?? message; } catch { /* keep default */ }
    throw new Error(message);
  }
  return ((await res.json()) as ApiResponse<T>).data;
}

export interface ImportSibResult {
  map: Mindmap;
  addedNodes: number;
  addedEdges: number;
}

export const mindmapApi = {
  list: () => request<MindmapSummary[]>('/mindmap/list', {
    headers: draftKeysHeader() ? { 'X-Draft-Keys': draftKeysHeader() } : {},
  }),
  importSib: (id: string, anchorId?: string) =>
    request<ImportSibResult>(`/mindmap/${id}/import-sib`, {
      method: 'POST',
      body: JSON.stringify(anchorId ? { anchorId } : {}),
    }, id),
  load: (id: string) => request<Mindmap>(`/mindmap/load/${id}`, {}, id),
  save: async (body: SaveMindmapRequest): Promise<Mindmap> => {
    const saved = await request<Mindmap & { draftKey?: string }>(
      '/mindmap/save', { method: 'POST', body: JSON.stringify(body) }, body.id);
    // Creation returns the draft key exactly once — keep it.
    if (saved.draftKey) storeDraftKey(saved.id, saved.draftKey);
    const { draftKey: _dk, ...map } = saved;
    return map;
  },
  remove: (id: string) => request<{ deleted: string }>(`/mindmap/${id}`, { method: 'DELETE' }, id),
  versions: (id: string) => request<Omit<MindmapVersion, 'snapshot'>[]>(`/mindmap/${id}/versions`, {}, id),
  restore: (id: string, versionId: string) =>
    request<Mindmap>(`/mindmap/${id}/restore/${versionId}`, { method: 'POST' }, id),
  publish: (id: string) => request<Mindmap>(`/mindmap/${id}/publish`, { method: 'POST' }, id),
  unpublish: (id: string) => request<Mindmap>(`/mindmap/${id}/unpublish`, { method: 'POST' }, id),
  unlock: async (draftKey: string): Promise<{ mapId: string; summary: MindmapSummary }> => {
    const result = await request<{ mapId: string; summary: MindmapSummary }>(
      '/mindmap/unlock', { method: 'POST', body: JSON.stringify({ draftKey }) });
    storeDraftKey(result.mapId, draftKey);
    return result;
  },
};

/** Server-side export (sib-json / svg / json) → browser download. */
export async function downloadServerExport(id: string, format: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;
  const draftKey = getDraftKey(id);
  if (draftKey) headers['X-Draft-Key'] = draftKey;

  const res = await fetch('/mindmap/export', {
    method: 'POST', headers, body: JSON.stringify({ id, format }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = ((await res.json()) as { error?: string }).error ?? message; } catch { /* keep default */ }
    throw new Error(message);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `mindmap.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
