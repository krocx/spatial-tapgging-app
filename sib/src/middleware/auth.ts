// auth.ts — Phase 2.5
// API key middleware.  Every route except /health requires a valid X-API-Key header.
//
// Configuration:
//   SIB_API_KEY env var — when set, all requests must supply this exact value.
//   When NOT set (local dev without the env var), the middleware is a no-op
//   so local npm run dev continues to work without any key.

import type { Request, Response, NextFunction } from 'express';
import type { UamRole, UamUser } from '@spatial/shared';
import { logOpsEvent } from '../ops-log.js';
import { verifyToken } from '../uam/uam-core.js';
// Circular at module level, resolved at call time (same pattern as tag-emitter ↔ routes).
import { uamUserStore, uamSecret, findUserByEmail } from '../routes/uam.js';

/** The API key a request carries — X-API-Key header, or the `sib_key` cookie
 *  set by the /unlock page (browsers can't add headers to page navigations). */
export function providedApiKey(req: Request): string | undefined {
  const h = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];
  if (h) return h;
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  const m = /(?:^|;\s*)sib_key=([^;]*)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** True when no key is configured (internal deployments) or the request carries it. */
export function hasValidApiKey(req: Request): boolean {
  const expected = process.env.SIB_API_KEY?.trim();
  if (!expected) return true;
  return providedApiKey(req) === expected;
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.SIB_API_KEY?.trim();

  // Dev mode — no key configured, allow everything
  if (!expectedKey) { next(); return; }

  const provided = providedApiKey(req);

  if (!provided || provided !== expectedKey) {
    res.status(401).json({
      error: 'Unauthorized: missing or invalid X-API-Key header',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}

// ── Content gate (IP hardening) ──────────────────────────────────────────────
// When SIB_API_KEY is set (internet-facing deployments), EVERY surface —
// pages, docs, catalogue, stats, Ask SIB — requires the key. Browsers can't
// attach headers to page navigations, so the /unlock page stores the key in
// an HttpOnly cookie that this gate also accepts. Internal deployments
// (no key configured) are untouched.
//
// Public exceptions, deliberately tiny:
//   /health  — Render's container probe
//   /unlock  — the door itself (serves no data)
//   /config  — auth-mode booleans only; platformVersion is stripped for
//              unauthenticated callers in the route itself.

export function contentGate(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.SIB_API_KEY?.trim()) { next(); return; }   // internal deployment — open
  if (req.method === 'OPTIONS') { next(); return; }            // CORS preflight
  if (req.path === '/health' || req.path === '/unlock' || req.path === '/config') { next(); return; }
  if (hasValidApiKey(req)) { next(); return; }

  const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
  if (wantsHtml) {
    // Same-origin paths only — never a redirect target an attacker controls.
    const target = req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//')
      ? req.originalUrl : '/';
    res.redirect(302, '/unlock?next=' + encodeURIComponent(target));
    return;
  }
  res.status(401).json({
    error: 'Unauthorized: missing or invalid X-API-Key header',
    timestamp: new Date().toISOString(),
  });
}

// ── UAM identity (RBAC ahead of SSO) ─────────────────────────────────────────
// Token from POST /uam/login travels as the X-User-Token header (iOS) or the
// sib_user cookie (portal). The token asserts only the email; role is re-read
// from the user store on EVERY request so role changes and removals take
// effect immediately. SSO swap point: replace verifyToken with IdP JWT
// validation — everything downstream is unchanged.

export const UAM_COOKIE = 'sib_user';

export function currentUamUser(req: Request): UamUser | undefined {
  const h = Array.isArray(req.headers['x-user-token'])
    ? req.headers['x-user-token'][0]
    : req.headers['x-user-token'];
  let token = h;
  if (!token && req.headers.cookie) {
    const m = new RegExp(`(?:^|;\\s*)${UAM_COOKIE}=([^;]*)`).exec(req.headers.cookie);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return undefined;
  const email = verifyToken(token, uamSecret());
  if (!email) return undefined;
  return findUserByEmail(email);
}

/** The acting identity for privileged operations: a signed-in UAM user, or
 *  the legacy admin key acting as owner-equivalent (bootstrap + transition). */
export type UamActor =
  | { kind: 'user'; user: UamUser; role: UamRole; email: string }
  | { kind: 'legacy-admin' };

export function uamActor(req: Request): UamActor | undefined {
  const user = currentUamUser(req);
  if (user) return { kind: 'user', user, role: user.role, email: user.email };
  const adminKey = process.env.SIB_ADMIN_KEY?.trim();
  if (adminKey) {
    const provided = Array.isArray(req.headers['x-admin-key'])
      ? req.headers['x-admin-key'][0]
      : req.headers['x-admin-key'];
    if (provided === adminKey) return { kind: 'legacy-admin' };
  } else {
    // No admin key configured (internal dev) — management stays reachable,
    // matching the platform's historical gate-off behaviour.
    return { kind: 'legacy-admin' };
  }
  return undefined;
}

/** Route middleware: require a signed-in user with one of `roles`
 *  (legacy admin key counts as owner). */
export function requireRole(...roles: UamRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = uamActor(req);
    const effective: UamRole | undefined =
      actor?.kind === 'legacy-admin' ? 'owner' : actor?.role;
    if (effective && roles.includes(effective)) { next(); return; }
    res.status(403).json({
      error: `Requires role: ${roles.join(' or ')}`,
      timestamp: new Date().toISOString(),
    });
  };
}

// ── IP-sensitivity gate (secondary secret) ───────────────────────────────────
// SIB_IP_KEY env var — when set, catalogue features marked
// `sensitivity: restricted` are redacted (body/flows/api/spec stripped) for
// anyone without the key, and their deep-dive docs return 403. When NOT set,
// everything is visible (internal deployments unchanged).
//
// THE RBAC SWAP POINT: when SSO lands, this function's key comparison becomes
// a role-claim check (e.g. req.user.roles.includes('ip-viewer')). Nothing
// else in the codebase needs to change — every restricted-content decision
// flows through here.

export function canViewRestricted(req: Request): boolean {
  const key = process.env.SIB_IP_KEY?.trim();
  if (!key) return true;                                   // gate off — open
  const h = Array.isArray(req.headers['x-ip-key'])
    ? req.headers['x-ip-key'][0]
    : req.headers['x-ip-key'];
  if (h === key) return true;
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  const m = /(?:^|;\s*)sib_ip_key=([^;]*)/.exec(cookie);
  return !!m && decodeURIComponent(m[1]) === key;
}

// ── Admin gate (pilot hardening) ─────────────────────────────────────────────
// SIB_ADMIN_KEY env var — when set, DESTRUCTIVE requests additionally require
// a matching X-Admin-Key header. Destructive = any DELETE, plus the LOTO quiz
// admin surface (answers + bank edits). When NOT set, this is a no-op so
// local dev and single-team deployments behave exactly as before.
//
// This is deliberately a second shared secret, not per-user RBAC — the pilot
// risk it closes is an accidental cascade delete from a review-only browser
// tab, not a malicious insider. Real RBAC arrives with SSO (roadmap:
// Enterprise Platform pillar).

export function isAdminRequest(method: string, path: string): boolean {
  if (method === 'DELETE') return true;
  if (path.startsWith('/admin/')) return true;                                   // ops: backups etc.
  if (path.startsWith('/loto/quiz/admin')) return true;                          // bank WITH answers
  if (path.startsWith('/loto/quiz/questions')) return true;                      // add/edit/delete
  if (path === '/loto/quiz/import') return true;                                 // bulk replace
  return false;
}

export function adminKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminRequest(req.method, req.path)) { next(); return; }

  // UAM transition: a signed-in Owner or Manager passes the destructive gate
  // by role — no shared admin key needed. Engineers/Technicians fall through
  // to the legacy key check (and normally fail it, which is the point).
  const user = currentUamUser(req);
  if (user && (user.role === 'owner' || user.role === 'manager')) {
    logOpsEvent({ method: req.method, path: req.path, outcome: 'allowed', ip: req.ip,
      detail: `by role — ${user.email} (${user.role})` });
    next();
    return;
  }

  const adminKey = process.env.SIB_ADMIN_KEY?.trim();
  if (!adminKey) {
    // Gate not configured — action proceeds, but the ops log still records it.
    logOpsEvent({ method: req.method, path: req.path, outcome: 'gate-off', ip: req.ip });
    next();
    return;
  }

  const provided = Array.isArray(req.headers['x-admin-key'])
    ? req.headers['x-admin-key'][0]
    : req.headers['x-admin-key'];

  if (!provided || provided !== adminKey) {
    logOpsEvent({ method: req.method, path: req.path, outcome: 'denied', ip: req.ip });
    res.status(403).json({
      error: 'Admin key required: this action is destructive. Unlock admin mode in the portal (X-Admin-Key).',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  logOpsEvent({ method: req.method, path: req.path, outcome: 'allowed', ip: req.ip });
  next();
}
