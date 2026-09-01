// uam-core.ts — User Access Management, pure logic (no I/O, no stores).
//
// Pre-SSO RBAC: identities live in a manually managed allow-list (the UAM
// table in the portal); POST /uam/login identifies against it and issues an
// HMAC-signed token. The token deliberately carries ONLY email + expiry —
// role is re-read from the user store on every request, so a role change
// (or removal from the list) takes effect immediately, not at token expiry.
//
// THE SSO SWAP POINT (with canViewRestricted's sibling in auth.ts): when
// corporate OIDC + HYPR arrive, token issuing moves to the IdP and
// verification moves to JWKS — every role rule below survives unchanged.

import crypto from 'crypto';
import type { UamRole } from '@spatial/shared';

export const UAM_ROLES: readonly UamRole[] = ['owner', 'manager', 'engineer', 'technician'];

/** Higher = more privileged. */
const RANK: Record<UamRole, number> = { owner: 3, manager: 2, engineer: 1, technician: 0 };

export function isUamRole(v: unknown): v is UamRole {
  return typeof v === 'string' && (UAM_ROLES as readonly string[]).includes(v);
}

export function roleAtLeast(role: UamRole, min: UamRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * May `actor` create/modify/delete a user record of `targetRole`?
 *   owner    → anyone (including other owners)
 *   manager  → anyone EXCEPT owner records, and may never grant owner
 *   engineer/technician → nobody
 */
export function canManageRole(actor: UamRole, targetRole: UamRole): boolean {
  if (actor === 'owner') return true;
  if (actor === 'manager') return targetRole !== 'owner';
  return false;
}

/** The identity key: lowercase, trimmed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Session tokens ───────────────────────────────────────────────────────────
// Format: base64url(email)|expiryEpochMs|hex(HMAC-SHA256(secret, email|expiry))

export const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;   // matches the IP-key rhythm

export function makeToken(email: string, secret: string, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS;
  const body = `${normalizeEmail(email)}|${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${Buffer.from(normalizeEmail(email)).toString('base64url')}|${exp}|${sig}`;
}

/** Returns the email the token asserts, or null (expired / tampered / malformed). */
export function verifyToken(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split('|');
  if (parts.length !== 3) return null;
  const [emailB64, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || now > exp) return null;
  let email: string;
  try { email = Buffer.from(emailB64, 'base64url').toString('utf8'); } catch { return null; }
  const expected = crypto.createHmac('sha256', secret).update(`${email}|${exp}`).digest('hex');
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? email : null;
}
