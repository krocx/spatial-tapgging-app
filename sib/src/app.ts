import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import anchorRouter, { anchorStore, QRIMAGES_DIR } from './routes/anchors.js';
import tagRouter from './routes/tags.js';
import sessionRouter from './routes/sessions.js';
import perceptionRouter from './routes/perception.js';
import trainingRouter from './routes/training.js';
import locTagRouter from './routes/loc-tags.js';
import worldMapRouter from './routes/worldmap.js';
import guideRouter from './routes/guides.js';
import guideSessionRouter from './routes/guide-sessions.js';
import tagGroupRouter from './routes/tag-groups.js';
import modelRouter from './routes/models.js';
import mindmapRouter from './routes/mindmap.routes.js';
import lotoRouter from './routes/loto.js';
import { apiKeyAuth } from './middleware/auth.js';
// NOT from @spatial/shared: that package is types-only at runtime — its exports
// point at .ts source, which a compiled server cannot load. See sib/src/version.ts.
import { PLATFORM_VERSION } from './version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();

  // --- Middleware ---
  app.use(cors());
  // 30mb — a full 19-image training sweep (800px JPEGs, q0.65, base64 +
  // AES-GCM re-base64) plus per-tag depth-map metadata PATCHes can run
  // several MB; 10mb was tripping "payload too large" even at the
  // 14-image minimum on busier/noisier camera frames.
  app.use(express.json({ limit: '30mb' })); // allow base64 image payloads

  // --- Health check (no auth — used by Render for container health probes) ---
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- Server config (no auth — read by the portal to auto-detect auth mode) ---
  // authRequired: true  → SIB_API_KEY is set (Render / any externally-accessible server)
  // authRequired: false → SIB_API_KEY not set (company network / local dev)
  // The portal uses this to decide whether to show the API key setup banner.
  app.get('/config', (_req, res) => {
    res.json({
      authRequired: !!(process.env.SIB_API_KEY?.trim()),
      // Single platform version for the whole release train — see docs/VERSIONING.md.
      platformVersion: PLATFORM_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Anchor Directory portal (no auth — team members enter their own API key) ---
  // Served at /portal — a browser-based anchor browser + QR generator.
  // index.html is served with no-cache so browsers always fetch the latest
  // version after a server update.  Assets (CSS, images) can still be cached.
  app.use('/portal', express.static(path.join(__dirname, '../portal'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));
  app.get('/portal', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../portal/index.html'));
  });

  // --- Roadmap Mind-Mapper (no auth on static assets — same model as /portal;
  // the app reads /config and asks for the API key before touching /mindmap/*).
  // Built bundle lives in sib/roadmap/ (source: sib/roadmap-client/).
  app.use('/roadmap', express.static(path.join(__dirname, '../roadmap'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('/roadmap', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '../roadmap/index.html'));
  });

  // --- GET /anchors/:id/qrprint — print-ready QR page (no auth required) ---
  // Serves a self-contained A4 HTML page with the QR image embedded as a
  // base64 data URL (no external requests from the printed page).
  // The QR is rendered at its exact physical print size (anchor.qrSizeCm cm).
  // Route is intentionally placed BEFORE apiKeyAuth so browsers can open it
  // in a new tab without needing to pass a header; the anchor UUID provides
  // sufficient access control for this read-only display page.
  app.get('/anchors/:id/qrprint', (req, res) => {
    const anchor = anchorStore.findById(req.params.id);
    if (!anchor) {
      return res.status(404).send('<!DOCTYPE html><html><body><p>Anchor not found.</p></body></html>');
    }

    const qrPath = path.join(QRIMAGES_DIR, `${anchor.id}.png`);
    let qrDataUrl = '';
    try {
      const png = fs.readFileSync(qrPath);
      qrDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    } catch { /* QR not yet generated — show placeholder */ }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const assetId    = esc(anchor.assetId);
    const qrSizeCm   = anchor.qrSizeCm ?? 10;
    const anchorShort = anchor.id.slice(0, 22) + '…';
    const createdAt  = new Date(anchor.createdAt).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QR — ${assetId}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
      display: flex; flex-direction: column; align-items: center;
      padding: 40px 20px 20px; color: #1a1a1a; background: #fff;
    }
    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; margin-bottom: 4px; text-align: center; }
    .subtitle { font-size: 12px; color: #777; margin-bottom: 28px; text-align: center; }
    .qr-wrap {
      width: ${qrSizeCm}cm; height: ${qrSizeCm}cm;
      background: #fff; padding: 3px;
      border: 1px solid #d0d0d0; border-radius: 4px;
    }
    .qr-wrap img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
    .qr-missing { width: ${qrSizeCm}cm; height: ${qrSizeCm}cm; display: flex; align-items: center;
      justify-content: center; border: 2px dashed #ccc; color: #999; font-size: 13px; text-align: center; }
    .meta { margin-top: 20px; text-align: center; }
    .meta p { font-size: 11px; color: #555; margin-bottom: 5px; line-height: 1.6; }
    .meta code {
      font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
      font-size: 10px; background: #f4f4f4; padding: 2px 6px; border-radius: 3px;
    }
    .size-note { font-size: 10px; color: #aaa; margin-top: 12px; }
    .print-btn {
      margin-top: 28px; padding: 10px 28px;
      background: #007AFF; color: #fff; border: none;
      border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .print-btn:hover { background: #0063cc; }
    @media print {
      .print-btn { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>${assetId}</h1>
  <p class="subtitle">Anchor QR Code &middot; Scan with SpatialTagging iOS app</p>
  ${qrDataUrl
    ? `<div class="qr-wrap"><img src="${qrDataUrl}" alt="QR code for ${assetId}"></div>`
    : `<div class="qr-missing">QR image not ready yet.<br>Reload in a moment.</div>`
  }
  <div class="meta">
    <p>Asset: <strong>${assetId}</strong></p>
    <p>Anchor ID: <code>${anchorShort}</code></p>
    <p>Created: ${createdAt}</p>
  </div>
  <p class="size-note">&#x1F4D0; Print at ${qrSizeCm}&thinsp;cm &times; ${qrSizeCm}&thinsp;cm for correct scanning distance</p>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  <script>
    window.addEventListener('load', function() {
      // Auto-open print dialog after a short delay so the image is fully rendered.
      // The user can cancel if they only wanted to preview.
      setTimeout(function() { window.print(); }, 600);
    });
  <\/script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(html);
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

  // --- Phase 2: Loc-Tag (Gemba audit walk) ---
  // POST   /loc-tags                    — Author: create a LocTag
  // GET    /loc-tags?anchorId=xxx       — list LocTags for an anchor
  // GET    /loc-tags/image/:filename    — serve reference / completion photo
  // POST   /loc-tags/:id/completion     — Operator: submit completion
  // GET    /loc-tags/:id/completions    — list completions for a LocTag
  app.use('/loc-tags', locTagRouter);

  // POST /worldmap/upload               — Author: save ARWorldMap after walk
  // GET  /worldmap/:anchorId            — Operator: download ARWorldMap to re-localize
  app.use('/worldmap', worldMapRouter);

  // --- AR OMS: Guided work instructions (Phase 1) ---
  // POST   /guides                           — Author: create Guide
  // GET    /guides?anchorId=xxx              — list published guides for Operators
  // GET    /guides?anchorId=xxx&all=true     — list all guides (drafts + published) for Authors
  // GET    /guides/:id                       — get Guide
  // PATCH  /guides/:id                       — Author: update name / description / published
  // DELETE /guides/:id                       — Author: cascade-delete Guide + Steps
  // GET    /guides/:id/steps                 — list Steps in sequence order
  // POST   /guides/:id/steps                 — Author: create Step (with optional image)
  // PATCH  /guides/:id/steps/:stepId         — Author: update Step
  // DELETE /guides/:id/steps/:stepId         — Author: delete Step
  // GET    /guides/step-image/:filename      — serve step media image
  app.use('/guides', guideRouter);

  // POST /guide-sessions                     — Operator: submit completed session (sign-off)
  // GET  /guide-sessions?anchorId=xxx        — list sessions for an anchor
  // GET  /guide-sessions?guideId=xxx         — list sessions for a guide
  // GET  /guide-sessions/:id                 — get session
  app.use('/guide-sessions', guideSessionRouter);

  // --- Tag Groups: Inspection Sets ---
  // POST   /tag-groups                       — Author: create an Inspection Set
  // GET    /tag-groups?anchorId=xxx          — list Inspection Sets for an anchor
  // GET    /tag-groups/:id                   — get a single TagGroup
  // PATCH  /tag-groups/:id                   — Author: rename / update description
  // DELETE /tag-groups/:id                   — Author: delete group (tags lose groupId, not deleted)
  app.use('/tag-groups', tagGroupRouter);

  // --- 3D Model asset library ---
  // POST   /models?anchorId=&name=&uploadedBy=  — Upload binary 3D file (GLB/USDZ pass-through; OBJ/FBX/STEP async Blender conversion)
  // GET    /models?anchorId=xxx                 — List models for an anchor
  // GET    /models/:id                          — Model metadata + status
  // PATCH  /models/:id                          — Rename
  // DELETE /models/:id                          — Delete model + files
  // GET    /models/:id/file.glb                 — Serve the GLB file
  // GET    /models/:id/file.usdz                — Serve the USDZ file (if available)
  app.use('/models', modelRouter);

  // --- Roadmap Mind-Mapper API ---
  // POST   /mindmap/save                    — create / full-save a map (+version snapshot)
  // GET    /mindmap/load/:id                — load a map
  // GET    /mindmap/list                    — list map summaries
  // POST   /mindmap/export                  — { id, format: json|svg } → file download
  // GET    /mindmap/:id/versions            — version history (metadata only)
  // POST   /mindmap/:id/restore/:versionId  — restore a snapshot
  // DELETE /mindmap/:id                     — delete map + versions
  // (Real-time collaboration: WebSocket at /mindmap/ws — see ws/mindmap.ws.ts)
  app.use('/mindmap', mindmapRouter);

  // --- iLOTO — spatial Lockout/Tagout (docs/ILOTO.md) ---
  // POST   /loto/points                — author: define an isolation point
  // GET    /loto/points?anchorId=      — list points
  // PATCH  /loto/points/:id            — author: update label/circuit/model/position
  // DELETE /loto/points/:id            — author: remove (blocked while locked; events kept)
  // POST   /loto/events                — apply / remove / override-remove (APPEND-ONLY; server validates)
  // GET    /loto/events?anchorId=      — audit trail, newest first
  // GET    /loto/events/photo/:file    — evidence photo
  // GET    /loto/status?anchorId=      — derived per-point + panel summary
  // GET    /loto/my?userId=            — my active locks across anchors
  // POST   /loto/map                   — save a new flow-map version
  // GET    /loto/map?anchorId=         — latest flow map (404 when none)
  // DELETE /loto/map?anchorId=         — remove the flow map
  // GET    /loto/quiz                  — training questions (answers withheld)
  // POST   /loto/quiz/submit           — grade server-side → certification
  // GET    /loto/certifications        — cert records, newest first
  app.use('/loto', lotoRouter);

  // --- 404 fallback ---
  app.use((_req, res) => {
    res.status(404).json({
      error: 'Route not found',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
