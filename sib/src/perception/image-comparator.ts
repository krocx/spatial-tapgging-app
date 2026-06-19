// image-comparator.ts — v3
//
// Three metrics combined for robust presence/absence detection:
//
//  1. ssim_full   — grayscale SSIM on full image (overall structural context)
//  2. color_tight — RGB histogram intersection on the inner 25 % crop
//                   (directly detects a coloured part being removed; the tight
//                   crop isolates the inspected component from the unchanged
//                   background that would otherwise dominate a full-frame hist)
//  3. ssim_center — grayscale SSIM on the inner 50 % crop
//                   (structural detail of the component area)
//
// combined = 0.25 × ssim_full + 0.50 × color_tight + 0.25 × ssim_center
// PASS when combined ≥ PASS_THRESHOLD (env var, default 0.60)
//
// Why tight-crop for colour?
//   The outer disc and background are identical in pass and fail frames, so a
//   full-image colour histogram is ~75 % identical regardless of whether the
//   inner component is present.  A 25%-width crop centred on the component
//   forces the colour metric to focus where it matters.
//
// Why not grayscale-only?
//   Parts like the amber/gold ACD connector have distinctive colour but similar
//   luminance to the surrounding silver metal (≈166 vs 180), so grayscale SSIM
//   cannot distinguish presence from absence.

import Jimp from 'jimp';
import { createHash } from 'crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE = 256;                            // both images resized to SIZE × SIZE
const C1   = (0.01 * 255) ** 2;             // SSIM stability constants
const C2   = (0.03 * 255) ** 2;
const BINS = 64;                             // histogram bins per colour channel

// Medium crop — inner 50 % — for SSIM
const MED_START = Math.floor(SIZE / 4);      // 64
const MED_END   = Math.floor(3 * SIZE / 4); // 192
const MED_W     = MED_END - MED_START;       // 128

// Tight crop — inner 25 % — for colour histogram
const TIGHT_START = Math.floor(SIZE * 3 / 8); // 96
const TIGHT_END   = Math.floor(SIZE * 5 / 8); // 160
const TIGHT_W     = TIGHT_END - TIGHT_START;   // 64

// ── Decoded-frame type ────────────────────────────────────────────────────────

interface DecodedFrame {
  gray:   Float32Array;  // grayscale BT.601, SIZE×SIZE
  center: Float32Array;  // grayscale medium crop, MED_W×MED_W
  tightR: Float32Array;  // R channel tight crop, TIGHT_W×TIGHT_W
  tightG: Float32Array;  // G channel tight crop, TIGHT_W×TIGHT_W
  tightB: Float32Array;  // B channel tight crop, TIGHT_W×TIGHT_W
}

// ── Reference-frame cache (SHA-256) ──────────────────────────────────────────
// Reference (pass-state) frames are stable — cache them.
// Live operator frames are NEVER cached: all camera JPEGs share the same JFIF
// header prefix, causing cache-key collisions that would return stale pixels
// and produce SSIM = 1.0 (100 % confidence) on every comparison.
//
// Bounded LRU — each decoded frame holds ~1.5MB of Float32Array data
// (gray + center + tight crops). Left unbounded, this cache grows forever as
// new tags/anchors are trained and never releases memory — a slow leak that
// was a contributing cause of the Render OOM ("ran out of memory, used over
// 512MB"). Cap it and evict the least-recently-used entry on overflow.
const REF_CACHE_MAX = 150; // ~150 × 1.5MB ≈ 225MB worst case, well under the 512MB instance limit

const refCache = new Map<string, DecodedFrame>();

function refCacheGet(key: string): DecodedFrame | undefined {
  const hit = refCache.get(key);
  if (hit) {
    // Refresh recency: re-insert so it moves to the end (Map preserves insertion order)
    refCache.delete(key);
    refCache.set(key, hit);
  }
  return hit;
}

function refCacheSet(key: string, frame: DecodedFrame): void {
  if (refCache.size >= REF_CACHE_MAX) {
    const oldestKey = refCache.keys().next().value;
    if (oldestKey !== undefined) refCache.delete(oldestKey);
  }
  refCache.set(key, frame);
}

function refCacheKey(base64: string): string {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  return createHash('sha256').update(raw).digest('hex');
}

// ── Image decoding ────────────────────────────────────────────────────────────

async function decodeFrame(base64: string): Promise<DecodedFrame> {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const buf = Buffer.from(raw, 'base64');

  const img = await Jimp.read(buf);
  img.resize(SIZE, SIZE);          // keep colour — do NOT greyscale yet

  const { data } = img.bitmap;     // RGBA Uint8Array, length = SIZE*SIZE*4
  const n = SIZE * SIZE;

  const gray   = new Float32Array(n);
  const center = new Float32Array(MED_W * MED_W);
  const tightR = new Float32Array(TIGHT_W * TIGHT_W);
  const tightG = new Float32Array(TIGHT_W * TIGHT_W);
  const tightB = new Float32Array(TIGHT_W * TIGHT_W);

  let ci = 0;  // center index
  let ti = 0;  // tight index

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const px = (row * SIZE + col) * 4;
      const r  = data[px];
      const g  = data[px + 1];
      const b  = data[px + 2];

      gray[row * SIZE + col] = 0.299 * r + 0.587 * g + 0.114 * b;

      if (row >= MED_START && row < MED_END && col >= MED_START && col < MED_END) {
        center[ci++] = gray[row * SIZE + col];
      }

      if (row >= TIGHT_START && row < TIGHT_END && col >= TIGHT_START && col < TIGHT_END) {
        tightR[ti]   = r;
        tightG[ti]   = g;
        tightB[ti++] = b;
      }
    }
  }

  return { gray, center, tightR, tightG, tightB };
}

async function decodeReference(base64: string): Promise<DecodedFrame> {
  const key    = refCacheKey(base64);
  const cached = refCacheGet(key);
  if (cached) return cached;
  const frame = await decodeFrame(base64);
  refCacheSet(key, frame);
  return frame;
}

// ── SSIM ──────────────────────────────────────────────────────────────────────

function computeSSIM(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let sA = 0, sB = 0;
  for (let i = 0; i < n; i++) { sA += a[i]; sB += b[i]; }
  const muA = sA / n, muB = sB / n;

  let vA = 0, vB = 0, cv = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - muA, db = b[i] - muB;
    vA += da * da; vB += db * db; cv += da * db;
  }
  vA /= n; vB /= n; cv /= n;

  const num = (2 * muA * muB + C1) * (2 * cv + C2);
  const den = (muA * muA + muB * muB + C1) * (vA + vB + C2);
  return den === 0 ? 0 : num / den;
}

// ── RGB colour histogram on tight crop ───────────────────────────────────────
// Computes per-channel histogram intersection and averages across R, G, B.
// Using the tight crop means the background (unchanged outer disc) is excluded,
// so only the component region drives the colour similarity score.

function computeTightColorHist(a: DecodedFrame, b: DecodedFrame): number {
  const channels: Array<[Float32Array, Float32Array]> = [
    [a.tightR, b.tightR],
    [a.tightG, b.tightG],
    [a.tightB, b.tightB],
  ];
  const n      = a.tightR.length;
  const bw     = 256 / BINS;
  let totalSim = 0;

  for (const [ca, cb] of channels) {
    const hA = new Float32Array(BINS);
    const hB = new Float32Array(BINS);
    for (let i = 0; i < n; i++) {
      hA[Math.min(BINS - 1, Math.floor(ca[i] / bw))]++;
      hB[Math.min(BINS - 1, Math.floor(cb[i] / bw))]++;
    }
    let intersection = 0;
    for (let k = 0; k < BINS; k++) intersection += Math.min(hA[k], hB[k]);
    totalSim += intersection / n;
  }
  return totalSim / 3;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CompareResult {
  score:        number;
  bestRefIndex: number;
  details: Array<{
    ssimFull:    number;
    colorTight:  number;
    ssimCenter:  number;
    combined:    number;
  }>;
}

export async function compareAgainstPassState(
  referenceBase64s: string[],
  liveBase64: string,
  /** Optional per-call override; falls back to PASS_THRESHOLD env var → 0.60 */
  thresholdOverride?: number,
): Promise<CompareResult & { status: 'PASS' | 'FAIL' }> {
  const threshold =
    typeof thresholdOverride === 'number' && thresholdOverride > 0 && thresholdOverride <= 1
      ? thresholdOverride
      : parseFloat(process.env.PASS_THRESHOLD ?? '0.60');

  if (referenceBase64s.length === 0) {
    return { score: 0, bestRefIndex: 0, details: [], status: 'FAIL' };
  }

  // Live frame: always freshly decoded — never cached
  // Reference frames: decoded once and cached by SHA-256
  const [liveFrame, ...refFrames] = await Promise.all([
    decodeFrame(liveBase64),
    ...referenceBase64s.map((ref, i) =>
      decodeReference(ref).catch(err => {
        console.warn(`[comparator] Could not decode reference #${i}:`, err);
        return null;
      })
    ),
  ]);

  let bestScore = -Infinity;
  let bestIndex = 0;
  const details: CompareResult['details'] = [];

  for (let i = 0; i < refFrames.length; i++) {
    const ref = refFrames[i];
    if (!ref) {
      details.push({ ssimFull: 0, colorTight: 0, ssimCenter: 0, combined: 0 });
      continue;
    }

    const ssimFull   = computeSSIM(ref.gray,    liveFrame.gray);
    const colorTight = computeTightColorHist(ref, liveFrame);
    const ssimCenter = computeSSIM(ref.center,   liveFrame.center);

    // 50 % weight on tight-crop colour — the key discriminator for part presence.
    // Grayscale SSIM alone cannot distinguish an amber part from silver metal
    // (similar luminance) but the colour histogram in the tight crop can.
    const combined = 0.25 * ssimFull + 0.50 * colorTight + 0.25 * ssimCenter;

    details.push({ ssimFull, colorTight, ssimCenter, combined });

    if (combined > bestScore) {
      bestScore = combined;
      bestIndex = i;
    }
  }

  const finalScore = Math.max(0, bestScore);

  console.log(
    `[comparator] best ref #${bestIndex}: ` +
    `ssim=${details[bestIndex]?.ssimFull.toFixed(3)} ` +
    `color_tight=${details[bestIndex]?.colorTight.toFixed(3)} ` +
    `ssim_center=${details[bestIndex]?.ssimCenter.toFixed(3)} ` +
    `→ combined=${finalScore.toFixed(3)} (threshold=${threshold}) ` +
    `→ ${finalScore >= threshold ? 'PASS' : 'FAIL'}`,
  );

  return {
    score:        parseFloat(finalScore.toFixed(4)),
    bestRefIndex: bestIndex,
    details,
    status:       finalScore >= threshold ? 'PASS' : 'FAIL',
  };
}
