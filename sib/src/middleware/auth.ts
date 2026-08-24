// auth.ts — Phase 2.5
// API key middleware.  Every route except /health requires a valid X-API-Key header.
//
// Configuration:
//   SIB_API_KEY env var — when set, all requests must supply this exact value.
//   When NOT set (local dev without the env var), the middleware is a no-op
//   so local npm run dev continues to work without any key.

import type { Request, Response, NextFunction } from 'express';
import { logOpsEvent } from '../ops-log.js';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.SIB_API_KEY?.trim();

  // Dev mode — no key configured, allow everything
  if (!expectedKey) { next(); return; }

  const provided = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];

  if (!provided || provided !== expectedKey) {
    res.status(401).json({
      error: 'Unauthorized: missing or invalid X-API-Key header',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
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
