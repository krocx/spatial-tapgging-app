// auth.ts — Phase 2.5
// API key middleware.  Every route except /health requires a valid X-API-Key header.
//
// Configuration:
//   SIB_API_KEY env var — when set, all requests must supply this exact value.
//   When NOT set (local dev without the env var), the middleware is a no-op
//   so local npm run dev continues to work without any key.

import type { Request, Response, NextFunction } from 'express';

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
