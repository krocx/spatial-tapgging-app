// models.ts — 3D Model global asset library for AR Guide step ghost overlays
//
// Endpoints:
//   POST   /models                    — Upload a 3D model file (binary body, params in query)
//   GET    /models                    — List ALL models in the global library
//   GET    /models?anchorId=xxx       — List models assigned to an anchor's kit
//   GET    /models/:id                — Get single model metadata
//   PATCH  /models/:id                — Update name / defaultScale
//   DELETE /models/:id                — Delete model + stored files
//   POST   /models/:id/kit            — Add or remove from an anchor's kit
//                                       Body: { action: 'add'|'remove', anchorId: string }
//   GET    /models/:id/file.glb       — Serve the GLB file
//   GET    /models/:id/file.usdz      — Serve the USDZ file (only if hasUSDZ=true)
//
// Upload protocol:
//   POST /models?name=MyPart&uploadedBy=Author   (anchorId optional — global upload)
//   Content-Type: <mime for the file>   (e.g. model/gltf-binary, application/octet-stream)
//   Body: raw binary file bytes
//
//   The server detects format from Content-Type + name extension, stores the file,
//   and dispatches async conversion if needed:
//     GLB / GLTF   → ready immediately (stored as GLB; usdzStatus='pending')
//                    Portal browser then converts GLB→USDZ and uploads via PUT /models/:id/file.usdz
//     USDZ         → ready immediately (stored as USDZ; hasUSDZ=true, usdzStatus='ready')
//     OBJ / FBX    → async Blender conversion → GLB (then browser converts to USDZ)
//     STEP / IGES  → async Blender conversion → GLB  (requires CAD addon)
//
// Conversion:
//   Uses Blender in headless mode when available.
//   If `blender` is not on PATH, CAD/mesh conversion fails gracefully with a
//   human-readable error suggesting the Author exports to GLB from their CAD tool.

import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs            from 'fs';
import path          from 'path';
import { spawnSync, spawn } from 'child_process';
import os            from 'os';
import type {
  Model3D,
  ModelFormat,
  ModelStatus,
  UpdateModel3DRequest,
  ApiResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const model3DStore = new JsonFileStore<Model3D>('models-3d');

const DATA_DIR    = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const MODELS_DIR  = path.join(DATA_DIR, 'models-3d');
fs.mkdirSync(MODELS_DIR, { recursive: true });

// ── Format detection ──────────────────────────────────────────────────────────

const MIME_TO_FORMAT: Record<string, ModelFormat> = {
  'model/gltf-binary':      'glb',
  'model/gltf+json':        'gltf',
  'model/vnd.usdz+zip':    'usdz',
  'model/usd':              'usdz',
  'application/octet-stream': 'glb',   // fallback — refined by extension below
};

const EXT_TO_FORMAT: Record<string, ModelFormat> = {
  '.glb':   'glb',
  '.gltf':  'gltf',
  '.usdz':  'usdz',
  '.obj':   'obj',
  '.fbx':   'fbx',
  '.step':  'step',
  '.stp':   'step',
  '.iges':  'iges',
  '.igs':   'iges',
};

function detectFormat(contentType: string, filename: string): ModelFormat | null {
  const ext = path.extname(filename).toLowerCase();
  if (EXT_TO_FORMAT[ext]) return EXT_TO_FORMAT[ext];
  const base = contentType.split(';')[0].trim().toLowerCase();
  return MIME_TO_FORMAT[base] ?? null;
}

// ── GLB → USDZ: browser-side conversion ──────────────────────────────────────
//
// GLB→USDZ conversion is performed in the portal browser using Three.js
// GLTFLoader + USDZExporter (where WebGL is available and the USDZExporter
// is well-supported). The browser uploads the resulting USDZ via
// PUT /models/:id/file.usdz, which stores it and sets hasUSDZ=true.
//
// This server keeps both the original GLB (for future AR-glasses / non-iOS use)
// and the converted USDZ (for iOS 26+ where SCNScene(url:) only loads USDZ).
//
// usdzStatus tracks the conversion state:
//   'pending' — GLB ready, USDZ not yet received from browser
//   'ready'   — USDZ received and stored; iOS app can download it
//   'failed'  — Browser reported conversion error (set by browser after failure)

// ── Blender conversion ────────────────────────────────────────────────────────

/** Embedded Blender Python script written to a temp file before invoking. */
const BLENDER_SCRIPT = `
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
inp, out = argv[0], argv[1]
ext = os.path.splitext(inp)[1].lower()

# Start from an empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)
for obj in bpy.data.objects:
    bpy.data.objects.remove(obj, do_unlink=True)

if ext == '.obj':
    bpy.ops.import_scene.obj(filepath=inp)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=inp)
elif ext in ('.step', '.stp', '.iges', '.igs'):
    # Requires "Import CAD" / "STEP Importer" addon — raises AttributeError if missing.
    try:
        bpy.ops.import_scene.step(filepath=inp)
    except AttributeError:
        sys.exit(2)   # signal: CAD addon not available
else:
    sys.exit(3)       # unsupported format

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_colors=True,
)
sys.exit(0)
`.trim();

/** Returns true if Blender is on PATH. */
function blenderAvailable(): boolean {
  const result = spawnSync('blender', ['--version'], { timeout: 5000 });
  return result.status === 0;
}

/**
 * Run a Blender conversion in the background.
 * Updates the model record when done (ready or failed).
 */
function runBlenderConversion(modelId: string, inputPath: string): void {
  // Write the Blender Python script to a temp file
  const scriptPath = path.join(os.tmpdir(), `sib_convert_${modelId}.py`);
  fs.writeFileSync(scriptPath, BLENDER_SCRIPT, 'utf8');

  const outputPath = path.join(MODELS_DIR, `${modelId}.glb`);
  const now = () => new Date().toISOString();

  const blender = spawn('blender', [
    '--background',
    '--python', scriptPath,
    '--',
    inputPath,
    outputPath,
  ], { timeout: 300_000 /* 5 min */ });

  blender.on('close', (code) => {
    // Clean up temp script
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }

    if (code === 0 && fs.existsSync(outputPath)) {
      model3DStore.update(modelId, {
        status:     'ready' as ModelStatus,
        hasGLB:     true,
        usdzStatus: 'pending',  // portal browser will convert GLB→USDZ and upload
        updatedAt:  now(),
      });
      console.log(`[SIB/models] Conversion complete: ${modelId}.glb (USDZ pending browser conversion)`);
    } else if (code === 2) {
      model3DStore.update(modelId, {
        status:         'failed' as ModelStatus,
        conversionError: 'CAD conversion requires the Blender "Import CAD" addon. '
                       + 'Please export your STEP/IGES file to GLB from FreeCAD or '
                       + 'Blender (with CAD Sketcher addon) and re-upload.',
        updatedAt: now(),
      });
      console.warn(`[SIB/models] CAD addon not available for ${modelId}`);
    } else {
      model3DStore.update(modelId, {
        status:         'failed' as ModelStatus,
        conversionError: `Blender exited with code ${code}. Check that the file is a valid ${
          model3DStore.findById(modelId)?.originalFormat ?? 'mesh'
        } file.`,
        updatedAt: now(),
      });
      console.warn(`[SIB/models] Conversion failed for ${modelId} (exit ${code})`);
    }
  });

  blender.on('error', (err) => {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    model3DStore.update(modelId, {
      status:         'failed' as ModelStatus,
      conversionError: `Blender not found or could not start: ${err.message}. `
                     + 'Install Blender on the server or pre-convert your file to GLB.',
      updatedAt: now(),
    });
    console.warn(`[SIB/models] Blender spawn error for ${modelId}: ${err.message}`);
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// ── GET /models/:id/file.glb ─────────────────────────────────────────────────
// Registered BEFORE /:id to avoid "file.glb" being matched as a model id.
router.get('/:id/file.glb', (req: Request, res: Response): void => {
  const model = model3DStore.findById(req.params.id);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
  if (!model.hasGLB) {
    res.status(409).json({
      error: model.status === 'processing'
        ? 'Model is still being converted. Poll GET /models/:id for status.'
        : `GLB not available: ${model.conversionError ?? model.status}`,
    });
    return;
  }
  const filePath = path.join(MODELS_DIR, `${model.id}.glb`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'GLB file missing on disk' }); return; }
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(model.name)}.glb"`);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// ── GET /models/:id/file.usdz ────────────────────────────────────────────────
router.get('/:id/file.usdz', (req: Request, res: Response): void => {
  const model = model3DStore.findById(req.params.id);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
  if (!model.hasUSDZ) { res.status(404).json({ error: 'USDZ not available for this model' }); return; }
  const filePath = path.join(MODELS_DIR, `${model.id}.usdz`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'USDZ file missing on disk' }); return; }
  res.setHeader('Content-Type', 'model/vnd.usdz+zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(model.name)}.usdz"`);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// ── PUT /models/:id/file.usdz — receive USDZ from portal browser ─────────────
// Called by the portal after in-browser GLB→USDZ conversion completes.
// Stores the USDZ alongside the existing GLB and sets hasUSDZ=true + usdzStatus='ready'.
router.put(
  '/:id/file.usdz',
  (req: Request, res: Response, next) => {
    express.raw({ type: '*/*', limit: '250mb' })(req, res, next);
  },
  (req: Request, res: Response): void => {
    const model = model3DStore.findById(req.params.id);
    if (!model) { res.status(404).json({ error: 'Model not found' }); return; }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Request body must be the raw USDZ file' });
      return;
    }

    const usdzPath = path.join(MODELS_DIR, `${model.id}.usdz`);
    try {
      fs.writeFileSync(usdzPath, body);
    } catch (err) {
      res.status(500).json({ error: 'Failed to write USDZ file to disk' });
      return;
    }

    model3DStore.update(model.id, {
      hasUSDZ:    true,
      usdzStatus: 'ready',
      updatedAt:  new Date().toISOString(),
    });
    console.log(`[SIB/models] USDZ received from browser (${(body.length / 1024).toFixed(1)} KB): ${model.id}.usdz`);

    const updated = model3DStore.findById(model.id)!;
    const resp: ApiResponse<Model3D> = { data: updated, timestamp: new Date().toISOString() };
    res.json(resp);
  },
);

// ── POST /models — upload a 3D model file ────────────────────────────────────
// Uses express.raw() applied at the route level so only this endpoint accepts binary bodies.
router.post(
  '/',
  (req: Request, res: Response, next) => {
    // Apply raw body parser only for this route (binary model file in body)
    express.raw({ type: '*/*', limit: '250mb' })(req, res, next);
  },
  (req: Request, res: Response): void => {
    const { anchorId, name, uploadedBy } = req.query as Record<string, string>;

    if (!name?.trim()) {
      res.status(400).json({ error: 'name query parameter is required' });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Request body must be the raw 3D model file' });
      return;
    }

    const contentType  = req.headers['content-type'] ?? 'application/octet-stream';
    const origFilename = (req.headers['x-filename'] as string | undefined) ?? `${name.trim()}.bin`;
    const format       = detectFormat(contentType, origFilename);

    if (!format) {
      res.status(415).json({
        error: `Unsupported format. Supported: GLB, GLTF, USDZ, OBJ, FBX, STEP, IGES.`,
      });
      return;
    }

    const id  = uuidv4();
    const now = new Date().toISOString();

    // Determine immediate vs async processing
    const passThrough = format === 'glb' || format === 'gltf' || format === 'usdz';
    const status: ModelStatus = passThrough ? 'ready' : 'processing';

    const model: Model3D = {
      id,
      anchorId:         anchorId || undefined,           // legacy field, optional
      anchorIds:        anchorId ? [anchorId] : [],      // kit: start with upload anchor if given
      name:             name.trim(),
      originalFormat:   format,
      originalFilename: origFilename,
      fileSizeBytes:    body.length,
      status,
      hasGLB:           false,
      hasUSDZ:          false,
      usdzStatus:       'pending',                        // updated to 'ready' when browser uploads USDZ
      uploadedBy:       uploadedBy?.trim() || undefined,
      createdAt:        now,
      updatedAt:        now,
    };

    // Save the file
    if (format === 'usdz') {
      // USDZ: store as-is — already iOS-ready, no conversion needed.
      fs.writeFileSync(path.join(MODELS_DIR, `${id}.usdz`), body);
      model.hasUSDZ    = true;
      model.usdzStatus = 'ready';
      model.status     = 'ready';
    } else if (format === 'glb' || format === 'gltf') {
      // GLB / GLTF: store as GLB. The portal browser converts to USDZ and
      // uploads via PUT /models/:id/file.usdz — no server-side conversion.
      const glbPath = path.join(MODELS_DIR, `${id}.glb`);
      fs.writeFileSync(glbPath, body);
      model.hasGLB     = true;
      model.usdzStatus = 'pending';
      model.status     = 'ready';
    } else {
      // OBJ / FBX / STEP / IGES: save original, trigger async Blender conversion
      const origExt  = `.${format}`;
      const origPath = path.join(MODELS_DIR, `${id}_original${origExt}`);
      fs.writeFileSync(origPath, body);
      model.status = 'processing';
    }

    model3DStore.save(model);
    console.log(`[SIB/models] Uploaded ${format.toUpperCase()} "${model.name}" (${model.id})${anchorId ? ` for anchor ${anchorId}` : ' (global)'}`);

    // Kick off async conversion for formats that need it
    if (!passThrough) {
      const ext      = format === 'step' ? '.step' : format === 'iges' ? '.iges' : `.${format}`;
      const origPath = path.join(MODELS_DIR, `${id}_original${ext}`);

      if (blenderAvailable()) {
        runBlenderConversion(id, origPath);
        console.log(`[SIB/models] Dispatched Blender conversion for ${id}`);
      } else {
        // Blender not available — fail immediately with helpful message
        model3DStore.update(id, {
          status:         'failed' as ModelStatus,
          conversionError: `Blender is not installed on this server. `
                         + `Please export your ${format.toUpperCase()} file to GLB `
                         + `using FreeCAD, Blender, or CAD Exchanger, then re-upload the GLB.`,
          updatedAt: new Date().toISOString(),
        });
        console.warn(`[SIB/models] No Blender — cannot convert ${format.toUpperCase()} ${id}`);
      }
    }

    const resp: ApiResponse<Model3D> = { data: model3DStore.findById(id)!, timestamp: now };
    res.status(201).json(resp);
  },
);

// ── GET /models — list all models, or filter by anchor kit ───────────────────
// Without anchorId: returns the full global library (for portal library view).
// With ?anchorId=xxx: returns models assigned to that anchor's kit —
//   matches anchorIds.includes(anchorId) OR legacy anchorId === anchorId.
router.get('/', (req: Request, res: Response): void => {
  const { anchorId } = req.query;
  let models = model3DStore.findAll();

  if (anchorId && typeof anchorId === 'string') {
    // Anchor kit filter (backward compatible with legacy anchorId field)
    models = models.filter(m =>
      (m.anchorIds ?? []).includes(anchorId) ||
      m.anchorId === anchorId
    );
  }

  models = models.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ data: models, timestamp: new Date().toISOString() });
});

// ── GET /models/:id — single model metadata ───────────────────────────────────
router.get('/:id', (req: Request, res: Response): void => {
  const model = model3DStore.findById(req.params.id);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
  res.json({ data: model, timestamp: new Date().toISOString() });
});

// ── PATCH /models/:id — update name / defaultScale ────────────────────────────
router.patch('/:id', (req: Request, res: Response): void => {
  const body  = req.body as UpdateModel3DRequest;
  const model = model3DStore.findById(req.params.id);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }

  const patch: Partial<Model3D> = { updatedAt: new Date().toISOString() };
  if (body.name?.trim())                patch.name         = body.name.trim();
  if (body.defaultScale !== undefined)  patch.defaultScale = body.defaultScale;

  const updated = model3DStore.update(req.params.id, patch);
  res.json({ data: updated, timestamp: new Date().toISOString() });
});

// ── POST /models/:id/kit — add or remove model from an anchor's kit ──────────
// Body: { action: 'add' | 'remove', anchorId: string }
router.post('/:id/kit', (req: Request, res: Response): void => {
  const { action, anchorId } = req.body as { action: 'add' | 'remove'; anchorId: string };
  const model = model3DStore.findById(req.params.id);
  if (!model)    { res.status(404).json({ error: 'Model not found' }); return; }
  if (!anchorId) { res.status(400).json({ error: 'anchorId is required' }); return; }
  if (action !== 'add' && action !== 'remove') {
    res.status(400).json({ error: 'action must be "add" or "remove"' });
    return;
  }

  // Build current list (merge legacy anchorId field for backward compat)
  const current = Array.from(new Set([
    ...(model.anchorIds ?? []),
    ...(model.anchorId ? [model.anchorId] : []),
  ]));

  const nextIds = action === 'add'
    ? (current.includes(anchorId) ? current : [...current, anchorId])
    : current.filter(id => id !== anchorId);

  const updated = model3DStore.update(req.params.id, {
    anchorIds: nextIds,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[SIB/models] Kit ${action}: model ${req.params.id} ${action === 'add' ? '→' : '✗'} anchor ${anchorId}`);
  res.json({ data: updated, timestamp: new Date().toISOString() });
});

// ── DELETE /models/:id ────────────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response): void => {
  const model = model3DStore.findById(req.params.id);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }

  // Remove stored files
  const tryUnlink = (p: string) => { try { fs.unlinkSync(p); } catch { /* already gone */ } };
  tryUnlink(path.join(MODELS_DIR, `${model.id}.glb`));
  tryUnlink(path.join(MODELS_DIR, `${model.id}.usdz`));
  tryUnlink(path.join(MODELS_DIR, `${model.id}_original.${model.originalFormat}`));

  model3DStore.delete(model.id);
  console.log(`[SIB/models] Deleted model ${model.id} ("${model.name}")`);
  res.status(204).send();
});

export default router;
