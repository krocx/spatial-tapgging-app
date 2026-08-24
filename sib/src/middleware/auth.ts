// auth.ts — Phase 2.5
// API key middleware.  Every route except /health requires a valid X-API-Key header.
//
// Configuration:
//   SIB_API_KEY env var — when set, all requests must supply this exact value.
//   When NOT set (local dev without the env var), the middleware is a no-op
//   so local npm run dev continues to work without any key.

import type { Request, Response, NextFunction } from 'express';
import { logOpsEvent } from '../ops-log.js';

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
