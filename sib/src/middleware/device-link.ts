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
