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

export const mindmapApi = {
  list: () => request<MindmapSummary[]>('/mindmap/list'),
  load: (id: string) => request<Mindmap>(`/mindmap/load/${id}`),
  save: (body: SaveMindmapRequest) =>
    request<Mindmap>('/mindmap/save', { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ deleted: string }>(`/mindmap/${id}`, { method: 'DELETE' }),
  versions: (id: string) => request<Omit<MindmapVersion, 'snapshot'>[]>(`/mindmap/${id}/versions`),
  restore: (id: string, versionId: string) =>
    request<Mindmap>(`/mindmap/${id}/restore/${versionId}`, { method: 'POST' }),
};
