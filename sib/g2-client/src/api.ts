// api.ts - the companion's view of SIB: a server, a device token for one
// guide (from a six-character code), the guide bundle, and the session
// endpoints the XR kit uses. The site key never comes here.
// Proprietary & Confidential · Applied Materials.

export interface Session { server: string; token: string; guideId: string; guideName: string; operator: string | null; expiresAt: string }

const KEY = 'sib.g2.session';
const SERVER_KEY = 'sib.g2.server';
const RECENT_KEY = 'sib.g2.recent';

export const loadServer = (): string => localStorage.getItem(SERVER_KEY) || '';
export const saveServer = (s: string): void => { localStorage.setItem(SERVER_KEY, s.replace(/\/+$/, '')); };
export function loadSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Session | null; return s && Date.parse(s.expiresAt) > Date.now() ? s : null; } catch { return null; }
}
export const saveSession = (s: Session | null): void => { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); };
export function recent(): { guideId: string; guideName: string; at: string }[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function remember(s: Session): void {
  const list = recent().filter(r => r.guideId !== s.guideId);
  list.unshift({ guideId: s.guideId, guideName: s.guideName, at: new Date().toISOString() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
}

async function call<T>(server: string, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const r = await fetch(server + path, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Device-Token': token } : {}), ...(init.headers || {}) } });
  if (!r.ok) { let e = r.statusText; try { e = ((await r.json()) as { error?: string }).error || e; } catch { /* keep */ } throw new Error(e); }
  return r.json() as Promise<T>;
}

/** Exchange a portal code for a device token. */
export async function redeem(server: string, code: string): Promise<Session> {
  const r = await call<{ data: { token: string; guideId: string; guideName: string; operator: string | null; expiresAt: string } }>(server, '/g2/redeem', { method: 'POST', body: JSON.stringify({ code }) });
  const s: Session = { server, ...r.data };
  saveSession(s); remember(s);
  return s;
}

export interface Bundle {
  guide: { id: string; name: string; anchorId: string; assembly?: { bounds?: { min: number[]; max: number[] } } };
  steps: Array<{ id: string; sequenceNumber: number; title?: string; text?: string; cadPosition?: number[]; nodes?: unknown[] }>;
  anchor?: { assetId?: string };
  validation?: Array<{ stepId: string; required: boolean; mode: string }>;
}
export async function fetchBundle(s: Session): Promise<Bundle> {
  const r = await call<{ data?: Bundle } & Bundle>(s.server, `/guides/${encodeURIComponent(s.guideId)}/bundle`, {}, s.token);
  return (r.data ?? r) as Bundle;
}

// ── Session recording - the same endpoints and shapes as the XR kit ──────────
export interface Live { id: string }
export async function openLive(s: Session, b: Bundle, operator: string): Promise<Live | null> {
  try {
    const r = await call<{ data?: Live } & Live>(s.server, '/guide-sessions/live', { method: 'POST', body: JSON.stringify({
      guideId: s.guideId, anchorId: b.guide.anchorId, guideName: b.guide.name, anchorName: b.anchor?.assetId || '', operatorName: operator,
      workContext: 'Even G2 · companion',
    }) }, s.token);
    return (r.data ?? r) as Live;
  } catch { return null; }
}
export async function event(s: Session, live: Live | null, type: string, stepId?: string, stepIndex?: number, extra: Record<string, unknown> = {}): Promise<void> {
  if (!live) return;
  try { await call(s.server, `/guide-sessions/live/${live.id}/events`, { method: 'POST', body: JSON.stringify({ type, stepId, stepIndex, ...extra }) }, s.token); } catch { /* fire and forget */ }
}
export interface Completion { stepId: string; enteredAt: string; completedAt: string; durationSeconds: number }
export async function submit(s: Session, b: Bundle, live: Live | null, name: string, startedAt: string, completions: Completion[]): Promise<void> {
  const completedAt = new Date().toISOString();
  await call(s.server, '/guide-sessions', { method: 'POST', body: JSON.stringify({
    guideId: s.guideId, anchorId: b.guide.anchorId, guideName: b.guide.name, anchorName: b.anchor?.assetId || '',
    signedOffBy: name, startedAt, completedAt,
    durationSeconds: Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
    stepCompletions: completions, ...(live ? { liveSessionId: live.id } : {}),
  }) }, s.token);
  await event(s, live, 'session:submitted');
}
