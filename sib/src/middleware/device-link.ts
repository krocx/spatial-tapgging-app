// device-link.ts - open a guide on a headset without typing the site key.
//
// The portal (already inside the content gate, and signed in to UAM when UAM
// is on) mints a single-use link token, valid ten minutes, bound to one
// guide. The QR carries /xr?guide=…&link=<token>. When the headset browser
// follows it, the content gate redeems the token once: it sets the same
// access cookie /unlock would set and redirects to the page without the
// token, with the issuing person's name as the operator hint so the session
// is attributed. The key itself is never in the QR (a QR can be photographed
// off a screen), a token is useless after one use or ten minutes, and it
// opens exactly one guide.
//
// In memory: links are short-lived and a restart only means scanning again.
// Proprietary & Confidential · Applied Materials.

import { randomBytes } from 'crypto';

export interface DeviceLink {
  token:      string;
  guideId:    string;
  profile?:   string;
  /** Who minted it (UAM email or employee id when known, else 'admin key' / 'portal'). */
  issuedBy:   string;
  issuedName?: string;
  issuedAt:   number;
  expiresAt:  number;
  used:       boolean;
}

export const LINK_TTL_MS = 10 * 60 * 1000;
const links = new Map<string, DeviceLink>();

function sweep(): void {
  const now = Date.now();
  for (const [k, l] of links) if (l.used || l.expiresAt < now) links.delete(k);
}

export function mintDeviceLink(guideId: string, issuedBy: string, issuedName?: string, profile?: string): DeviceLink {
  sweep();
  const token = randomBytes(24).toString('base64url');
  const link: DeviceLink = { token, guideId, ...(profile ? { profile } : {}), issuedBy, ...(issuedName ? { issuedName } : {}), issuedAt: Date.now(), expiresAt: Date.now() + LINK_TTL_MS, used: false };
  links.set(token, link);
  return link;
}

/** Redeem once. Returns the link when it is live, unused and for this guide; null otherwise. */
export function redeemDeviceLink(token: string, guideId: string): DeviceLink | null {
  const l = links.get(token);
  if (!l || l.used || l.expiresAt < Date.now() || l.guideId !== guideId) return null;
  l.used = true; links.delete(token);
  return l;
}

/** For tests and the admin view: how many links are outstanding. */
export function outstandingDeviceLinks(): number { sweep(); return links.size; }

// ── Codes and device tokens (Even G2 companion, 2026.4.46) ──────────────────
// A phone companion page (the SIB on G2 app inside the Even Realities app)
// has no camera and no site key. The portal mints a short code - six
// characters from an alphabet without look-alikes, shown as ABC-123, ten
// minutes, single use, one guide. The companion exchanges it for a device
// token: a bearer the content gate accepts for that guide's bundle and the
// session endpoints only, twelve hours, sent as X-Device-Token. The key
// never leaves the server; the code is useless after one use.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
export const CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export interface DeviceCode { code: string; guideId: string; issuedBy: string; issuedName?: string; issuedAt: number; expiresAt: number; used: boolean }
export interface DeviceToken { token: string; guideId: string; operator?: string; issuedAt: number; expiresAt: number }

const codes = new Map<string, DeviceCode>();
const tokens = new Map<string, DeviceToken>();

function sweepCodes(): void {
  const now = Date.now();
  for (const [k, c] of codes) if (c.used || c.expiresAt < now) codes.delete(k);
  for (const [k, t] of tokens) if (t.expiresAt < now) tokens.delete(k);
}
/** ABC-123 → ABC123; tolerant of spaces, dashes and lower case. */
export function normaliseCode(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1'); }

export function mintDeviceCode(guideId: string, issuedBy: string, issuedName?: string): DeviceCode {
  sweepCodes();
  let code = '';
  do { const b = randomBytes(6); code = [...b].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join(''); } while (codes.has(code));
  const c: DeviceCode = { code, guideId, issuedBy, ...(issuedName ? { issuedName } : {}), issuedAt: Date.now(), expiresAt: Date.now() + CODE_TTL_MS, used: false };
  codes.set(code, c);
  return c;
}
/** Shown to people with a dash in the middle. */
export function formatCode(code: string): string { return `${code.slice(0, 3)}-${code.slice(3)}`; }

/** Redeem a code once; returns a device token for its guide, or null. */
export function redeemDeviceCode(raw: string): DeviceToken | null {
  sweepCodes();
  const code = normaliseCode(raw);
  const c = codes.get(code);
  if (!c || c.used || c.expiresAt < Date.now()) return null;
  c.used = true; codes.delete(code);
  const t: DeviceToken = { token: randomBytes(24).toString('base64url'), guideId: c.guideId, ...(c.issuedName ? { operator: c.issuedName } : {}), issuedAt: Date.now(), expiresAt: Date.now() + DEVICE_TOKEN_TTL_MS };
  tokens.set(t.token, t);
  return t;
}
export function deviceTokenFor(token: string): DeviceToken | null {
  const t = tokens.get(token);
  return t && t.expiresAt >= Date.now() ? t : null;
}
/** What a device token may reach: its guide's bundle and steps, and the session endpoints. */
export function deviceTokenAllows(t: DeviceToken, method: string, path: string): boolean {
  const g = encodeURIComponent(t.guideId);
  if (method === 'GET' && (path === `/guides/${g}/bundle` || path === `/guides/${g}/steps` || path === `/guides/${g}` || path.startsWith('/guides/step-image/'))) return true;
  if (path.startsWith('/guide-sessions')) return true;
  if (path === '/config' || path === '/health') return true;
  return false;
}
export function outstandingDeviceCodes(): number { sweepCodes(); return codes.size; }
