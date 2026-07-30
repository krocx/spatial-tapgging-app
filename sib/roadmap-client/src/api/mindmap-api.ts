// mindmap-api.ts — REST client for /mindmap/*. Mirrors the portal's auth model:
// GET /config reports whether SIB_API_KEY is enforced; the key is kept in
// localStorage and sent as X-API-Key on every request.

import type { Mindmap, MindmapSummary, MindmapVersion, SaveMindmapRequest, ApiResponse } from '@spatial/shared';

const API_KEY_STORAGE = 'sib-api-key';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;

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
  list: () => request<MindmapSummary[]>('/mindmap/list'),
  importSib: (id: string, anchorId?: string) =>
    request<ImportSibResult>(`/mindmap/${id}/import-sib`, {
      method: 'POST',
      body: JSON.stringify(anchorId ? { anchorId } : {}),
    }),
  load: (id: string) => request<Mindmap>(`/mindmap/load/${id}`),
  save: (body: SaveMindmapRequest) =>
    request<Mindmap>('/mindmap/save', { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ deleted: string }>(`/mindmap/${id}`, { method: 'DELETE' }),
  versions: (id: string) => request<Omit<MindmapVersion, 'snapshot'>[]>(`/mindmap/${id}/versions`),
  restore: (id: string, versionId: string) =>
    request<Mindmap>(`/mindmap/${id}/restore/${versionId}`, { method: 'POST' }),
};

/** Server-side export (sib-json / svg / json) → browser download. */
export async function downloadServerExport(id: string, format: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;

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
