// Training & Validation routes — Author / Operator workflow
//
// POST /perception/train        — Author submits pass-state images for a tag
// POST /perception/validate     — Operator submits a live frame; SIB returns PASS/FAIL
// POST /perception/validate-all — Operator validates all tags for an anchor in one call
// GET  /perception/pass-state/:tagId — load pass-state for Operator mode

import { createDecipheriv } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  PassState,
  PassStateImage,
  ValidationResult,
  CreatePassStateRequest,
  ValidateRequest,
  BatchValidateRequest,
  TagValidationSummary,
  AnchorValidationResult,
  AnchorStatus,
  ApiResponse,
} from '@spatial/shared';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';
import {
  compareAgainstPassState,
  compareDualState,
  mapWithConcurrency,
  type ComparatorRoi,
} from '../perception/image-comparator.js';
import { tagStore } from './tags.js';
import { logInspection } from '../logging/inspection-logger.js';

const router = Router();

// ── AES-256-GCM decryption (Phase 2.5) ───────────────────────────────────────
// Stored images may be AES-256-GCM encrypted by the iOS client (CryptoKit).
// Format: base64(nonce[12] || ciphertext || authTag[16])
// The decryption key is sent by the Operator in BatchValidateRequest.encryptionKey
// (a base64-encoded 32-byte SymmetricKey from the QR code).
// Decryption happens in-memory; plaintext is never persisted.

function decryptImageBase64(encryptedBase64: string, keyBase64: string): string {
  const combined    = Buffer.from(encryptedBase64, 'base64');
  const key         = Buffer.from(keyBase64, 'base64');
  const nonce       = combined.subarray(0, 12);
  const authTag     = combined.subarray(combined.length - 16);
  const ciphertext  = combined.subarray(12, combined.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('base64');
}

// POST /perception/train
// Receives multi-viewpoint images (honeycomb capture) and stores as the
// canonical Pass state for the given tag.
router.post('/train', (req: Request, res: Response) => {
  const body = req.body as CreatePassStateRequest;

  if (!body.tagId || !body.anchorId || !body.assetId || !Array.isArray(body.images)) {
    return res.status(400).json({
      error: 'Missing required fields: tagId, anchorId, assetId, images[]',
      timestamp: new Date().toISOString(),
    });
  }

  if (body.images.length === 0) {
    return res.status(400).json({
      error: 'images[] must contain at least one capture',
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();

  // Optional: which reference this set of images represents. Defaults to
  // 'PASS' — every existing Author client that never sends `state` keeps
  // training the single Pass reference exactly as before. An Author may
  // additionally POST here with state: 'FAIL' to train what the *wrong*
  // condition looks like (cable unplugged, valve closed, switch off, etc.).
  const state = body.state === 'FAIL' ? 'FAIL' : 'PASS';

  // Stamp each image with an id and timestamp if not already set
  const images: PassStateImage[] = body.images.map(img => ({
    ...img,
    id: img.id ?? uuidv4(),
    capturedAt: img.capturedAt ?? now,
  }));

  // Upsert — replace any existing state of the SAME kind for this tag.
  // Training a Fail-state never touches the tag's Pass-state, and vice versa.
  const existing = findPassStateByTag(body.tagId, state);
  const passState: PassState = {
    id: existing?.id ?? uuidv4(),
    tagId: body.tagId,
    anchorId: body.anchorId,
    assetId: body.assetId,
    state,
    images,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // Re-training a tag fully replaces its honeycomb image set — drop the old
  // image blobs from disk first so retraining a tag repeatedly doesn't leak
  // orphaned image files under .sib-data/pass-state-images/.
  if (existing) passStateStore.delete(existing.id);
  passStateStore.save(passState);

  // Fire-and-forget post-training reference-cache warm-up.
  // Waits 5 s before decoding so the Author's ROI PATCH (which typically
  // arrives ~3 s after training) can land first — the ROI is baked into the
  // cache key, so we need to read it AFTER it's stored, not at training time.
  // For AES-256-GCM encrypted images this silently fails (no decryption key
  // available at training time); the first Operator inspection will pay the
  // decode cost in that case, same as before this change.
  if (state === 'PASS') {
    setTimeout(() => {
      void (async () => {
        try {
          const tag  = tagStore.findById(body.tagId);
          const roi  = tag?.roi;
          const refs = images.map(img => img.imageBase64);
          await compareAgainstPassState(refs, refs[0], undefined, roi);
          console.log(`[warmup] Reference cache pre-warmed: tag=${body.tagId} images=${refs.length}`);
        } catch {
          // Encrypted images, Jimp decode error, etc. — never affects the
          // training response that has already been sent.
        }
      })();
    }, 5_000);
  }

  const response: ApiResponse<PassState> = {
    data: passState,
    timestamp: now,
  };

  console.log(`[SIB] ${state} state trained: tag=${body.tagId}, images=${images.length}`);
  return res.status(201).json(response);
});

// POST /perception/validate
// Compares the live operator frame against the stored pass-state reference images
// using SSIM + histogram intersection. Returns PASS or FAIL with a confidence score.
router.post('/validate', async (req: Request, res: Response) => {
  const body = req.body as ValidateRequest;

  const required = ['tagId', 'anchorId', 'assetId', 'sessionId', 'imageBase64'];
  const missing = required.filter(k => !body[k as keyof ValidateRequest]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  }

  const passState = findPassStateByTag(body.tagId, 'PASS');
  if (!passState) {
    return res.status(404).json({
      error: `No pass state found for tag ${body.tagId}. Run Author mode first.`,
      timestamp: new Date().toISOString(),
    });
  }

  const tagForRoi = tagStore.findById(body.tagId);

  const now = new Date().toISOString();

  // Real comparison — SSIM + histogram intersection
  let comparison: Awaited<ReturnType<typeof compareAgainstPassState>>;
  try {
    comparison = await compareAgainstPassState(
      passState.images.map(img => img.imageBase64),
      body.imageBase64,
      undefined,
      tagForRoi?.roi,
    );
  } catch (err) {
    console.error('[SIB] Image comparison error:', err);
    return res.status(500).json({
      error: `Image comparison failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: now,
    });
  }

  const result: ValidationResult = {
    id:         uuidv4(),
    tagId:      body.tagId,
    anchorId:   body.anchorId,
    assetId:    body.assetId,
    sessionId:  body.sessionId,
    status:     comparison.status,
    confidence: parseFloat(comparison.score.toFixed(4)),
    evaluatedAt: now,
  };

  console.log(
    `[SIB] Validation: tag=${body.tagId} refs=${passState.images.length} ` +
    `score=${comparison.score.toFixed(3)} → ${result.status}`,
  );
  return res.status(200).json({ data: result, timestamp: now });
});

// POST /perception/validate-all
// Validates every tag attached to an anchor against a single operator frame.
// Optional body fields:
//   threshold  — override global PASS_THRESHOLD (0.0–1.0, default 0.60)
//   tagIds     — validate only this subset (for failed-only re-inspection)
// Returns an AnchorValidationResult with per-tag PASS/FAIL summaries.
router.post('/validate-all', async (req: Request, res: Response) => {
  const body = req.body as BatchValidateRequest;

  const required = ['anchorId', 'assetId', 'sessionId', 'imageBase64'];
  const missing = required.filter(k => !body[k as keyof BatchValidateRequest]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Resolve threshold: body param → env var → hardcoded default
  const threshold =
    typeof body.threshold === 'number' && body.threshold > 0 && body.threshold <= 1
      ? body.threshold
      : parseFloat(process.env.PASS_THRESHOLD ?? '0.60');

  // All tags registered for this anchor — excluding hidden step-validation
  // tags (V1): guide-step cone references are validated one-at-a-time by the
  // AR OMS flow, never as part of an anchor inspection sweep.
  let tags = tagStore.findAll().filter(t =>
    t.anchorId === body.anchorId &&
    !(t.metadata as Record<string, unknown> | undefined)?.step_validation);
  if (tags.length === 0) {
    return res.status(404).json({
      error: `No tags found for anchor ${body.anchorId}. Author mode must run first.`,
      timestamp: new Date().toISOString(),
    });
  }

  // If caller supplied a tagIds filter, restrict to those tags only
  if (Array.isArray(body.tagIds) && body.tagIds.length > 0) {
    const filterSet = new Set(body.tagIds);
    tags = tags.filter(t => filterSet.has(t.id));
  }

  const startedAt  = new Date().toISOString();
  const startMs    = Date.now();

  // Optional AES-256-GCM encryption key (base64, from QR scan on Operator device)
  const encryptionKey: string | undefined =
    typeof body.encryptionKey === 'string' && body.encryptionKey.length > 0
      ? body.encryptionKey
      : undefined;

  if (!encryptionKey) {
    // This means the Operator scanned a QR that didn't contain the encryption key
    // (e.g. the original physical QR rather than the app-generated one).
    // SSIM will run on raw ciphertext → confidence will be ~0. Log clearly.
    console.warn(
      `[SIB] validate-all: NO encryptionKey received for anchor=${body.anchorId}. ` +
      `If images were encrypted on upload, all results will show ~0% confidence. ` +
      `Operator must scan the app-generated QR (Author → QR icon) not the original physical QR.`
    );
  }

  // Decrypt one image set in-memory if an encryption key was supplied.
  // Plaintext images are never re-stored; they exist only for this comparison.
  // #66: also report whether ANY image in the set failed to decrypt, so the
  // caller can mark the result with errorReason: 'DECRYPT_FAILED' instead of
  // letting it surface as an indistinguishable ~0% confidence FAIL.
  const decryptAll = (images: string[], tagId: string): { images: string[]; failed: boolean } => {
    if (!encryptionKey) return { images, failed: false };
    let failed = false;
    const out = images.map((enc, i) => {
      try {
        return decryptImageBase64(enc, encryptionKey);
      } catch (decErr) {
        // Decryption failed — likely wrong key or unencrypted legacy image.
        // Log clearly; falling back to the raw stored blob (SSIM will score ~0).
        console.error(
          `[SIB] Decryption failed for image[${i}] tag=${tagId}: ` +
          `${decErr instanceof Error ? decErr.message : String(decErr)}`
        );
        failed = true;
        return enc;
      }
    });
    return { images: out, failed };
  };

  // Run comparisons with bounded concurrency; tags with no pass-state get
  // PENDING. Each tag comparison can itself trigger up to ~28 simultaneous
  // full-resolution JPEG decodes when a Fail-state is trained (see
  // image-comparator.ts), so letting every tag in the anchor run fully in
  // parallel here on top of that was the multiplier behind the OOM crashes —
  // cap how many tags are compared at once instead.
  const TAG_VALIDATION_CONCURRENCY = 2;
  const tagResults: TagValidationSummary[] = await mapWithConcurrency(
    tags,
    TAG_VALIDATION_CONCURRENCY,
    async (tag): Promise<TagValidationSummary> => {
      const passState = findPassStateByTag(tag.id, 'PASS');
      if (!passState || passState.images.length === 0) {
        return {
          tagId:      tag.id,
          tagLabel:   tag.label,
          tagType:    tag.type,
          status:     'PENDING',
          confidence: 0,
        };
      }

      // Optional per-tag inspection-region crop — absent means full frame,
      // identical to today's behaviour.
      const roi: ComparatorRoi | undefined = tag.roi;

      try {
        const passDecrypt = decryptAll(passState.images.map(img => img.imageBase64), tag.id);
        let decryptFailed = passDecrypt.failed;

        // Optional Fail-state: only present if the Author explicitly trained
        // one for this tag. When present, use the relative nearest-match
        // comparison instead of an absolute threshold against Pass alone.
        const failState = findPassStateByTag(tag.id, 'FAIL');
        if (failState && failState.images.length > 0) {
          const failDecrypt = decryptAll(failState.images.map(img => img.imageBase64), tag.id);
          decryptFailed ||= failDecrypt.failed;
          const dual = await compareDualState(passDecrypt.images, failDecrypt.images, body.imageBase64, roi);
          return {
            tagId:      tag.id,
            tagLabel:   tag.label,
            tagType:    tag.type,
            // #66: a decrypt failure makes the comparison meaningless — force
            // FAIL with a distinct reason rather than trusting whatever score
            // the comparator happened to produce against still-encrypted bytes.
            status:        decryptFailed ? 'FAIL' : dual.status,
            // #103: always expose the pass-similarity score (0–1) so the
            // displayed % means "how well the frame matched PASS references."
            // For dual-state, dual.confidence is the normalised margin
            // (0.5–1.0, can show FAIL 71%) which confuses non-tech users
            // who expect higher % = more likely PASS.  Using simToPass gives
            // FAIL 45% / PASS 71% — the direction is always intuitive.
            confidence:    decryptFailed ? 0 : parseFloat(dual.simToPass.toFixed(4)),
            ...(decryptFailed ? { errorReason: 'DECRYPT_FAILED' as const } : {}),
          };
        }

        const comparison = await compareAgainstPassState(
          passDecrypt.images,
          body.imageBase64,
          threshold,
          roi,
        );
        return {
          tagId:      tag.id,
          tagLabel:   tag.label,
          tagType:    tag.type,
          status:     decryptFailed ? 'FAIL' : comparison.status,
          confidence: decryptFailed ? 0 : parseFloat(comparison.score.toFixed(4)),
          ...(decryptFailed ? { errorReason: 'DECRYPT_FAILED' as const } : {}),
        };
      } catch (err) {
        console.error(`[SIB] Comparison failed for tag ${tag.id}:`, err);
        return {
          tagId:      tag.id,
          tagLabel:   tag.label,
          tagType:    tag.type,
          status:     'FAIL',
          confidence: 0,
        };
      }
    },
  );

  const durationMs   = Date.now() - startMs;
  const passCount    = tagResults.filter(r => r.status === 'PASS').length;
  const failCount    = tagResults.filter(r => r.status === 'FAIL').length;
  const pendingCount = tagResults.filter(r => r.status === 'PENDING').length;
  const totalCount   = tagResults.length;

  let anchorStatus: AnchorStatus;
  if (failCount === 0 && pendingCount === 0) {
    anchorStatus = 'PASS';
  } else if (passCount === 0 && pendingCount === 0) {
    anchorStatus = 'FAIL';
  } else if (pendingCount === totalCount) {
    anchorStatus = 'PENDING';
  } else {
    anchorStatus = 'PARTIAL';
  }

  const now = new Date().toISOString();
  const result: AnchorValidationResult = {
    id:          uuidv4(),
    anchorId:    body.anchorId,
    assetId:     body.assetId,
    sessionId:   body.sessionId,
    status:      anchorStatus,
    passCount,
    failCount,
    totalCount,
    tagResults,
    evaluatedAt: now,
    // #67: previously this was only a server console.warn — the Operator had
    // no way to know a uniform ~0% confidence across every tag was caused by
    // a missing encryption key (wrong QR scanned) rather than real mismatches.
    ...(!encryptionKey ? {
      warning: 'No encryption key received — scan the app-generated QR (Author → QR icon), ' +
               'not the original physical QR. Results below may show as FAIL with ~0% confidence.',
    } : {}),
  };

  console.log(
    `[SIB] validate-all: anchor=${body.anchorId} threshold=${threshold} ` +
    `tags=${totalCount} pass=${passCount} fail=${failCount} pending=${pendingCount} ` +
    `→ ${anchorStatus} (${durationMs}ms)`,
  );

  // Persist to inspection log (fire-and-forget — never blocks the response)
  try {
    logInspection({
      sessionId:     body.sessionId,
      anchorId:      body.anchorId,
      assetId:       body.assetId,
      operatorIP:    req.ip ?? 'unknown',
      threshold,
      startedAt,
      durationMs,
      overallStatus: anchorStatus,
      passCount,
      failCount,
      pendingCount,
      totalCount,
      tagResults: tagResults.map(r => ({
        tagId:      r.tagId,
        tagLabel:   r.tagLabel,
        tagType:    r.tagType,
        status:     r.status,
        confidence: r.confidence,
      })),
    });
  } catch (logErr) {
    // Never let logging failure affect the API response
    console.error('[logger] Failed to write inspection log:', logErr);
  }

  return res.status(200).json({ data: result, timestamp: now });
});

// GET /perception/pass-state/:tagId
// Operator mode loads the pass state to display the honeycomb reference.
router.get('/pass-state/:tagId', (req: Request, res: Response) => {
  const passState = findPassStateByTag(req.params.tagId);
  if (!passState) {
    return res.status(404).json({
      error: `No pass state for tag ${req.params.tagId}`,
      timestamp: new Date().toISOString(),
    });
  }
  return res.status(200).json({ data: passState, timestamp: new Date().toISOString() });
});

export default router;
