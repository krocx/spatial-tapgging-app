import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import anchorRouter from './routes/anchors.js';
import tagRouter from './routes/tags.js';
import sessionRouter from './routes/sessions.js';
import perceptionRouter from './routes/perception.js';
import trainingRouter from './routes/training.js';
import { apiKeyAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();

  // --- Middleware ---
  app.use(cors());
  app.use(express.json({ limit: '10mb' })); // allow base64 image payloads

  // --- Health check (no auth — used by Render for container health probes) ---
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- Anchor Directory portal (no auth — team members enter their own API key) ---
  // Served at /portal — a browser-based anchor browser + QR generator
  app.use('/portal', express.static(path.join(__dirname, '../portal')));
  app.get('/portal', (_req, res) => {
    res.sendFile(path.join(__dirname, '../portal/index.html'));
  });

  // --- API key auth — protects all routes below this point ---
  app.use(apiKeyAuth);

  // --- SIB Routes (Phase 1) ---
  // POST /anchors        — create anchor
  // GET  /anchors        — list anchors
  // GET  /anchors/:id    — get anchor
  app.use('/anchors', anchorRouter);

  // POST /tags           — create tag (requires anchorId)
  // GET  /tags           — list tags (filter: ?anchorId=)
  // GET  /tags/:id       — get tag
  app.use('/tags', tagRouter);

  // POST /sessions              — open session
  // GET  /sessions              — list sessions
  // GET  /sessions/:id          — get session
  // PATCH /sessions/:id/close   — close session
  app.use('/sessions', sessionRouter);

  // POST /perception/analyze-image — analyze image via adapter
  // GET  /perception/adapters      — list registered adapters
  app.use('/perception', perceptionRouter);

  // POST /perception/train               — Author: submit pass-state images
  // POST /perception/validate            — Operator: validate live frame (stub PASS)
  // GET  /perception/pass-state/:tagId   — load pass state for Operator mode
  app.use('/perception', trainingRouter);

  // --- 404 fallback ---
  app.use((_req, res) => {
    res.status(404).json({
      error: 'Route not found',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
