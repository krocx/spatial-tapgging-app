// image-comparator.ts — v5
//
// #83: before any metric runs, the live frame is coarsely re-aligned (small
// integer pixel translation, search-bounded) onto each reference individually
// — see "Coarse translation registration" below. This fixes viewpoint/
// parallax sensitivity at the source instead of only diluting it via
// WORST_FRACTION.
//
// Three metrics combined for robust presence/absence detection:
//
//  1. ssim_full   — grayscale SSIM on full image, scored as one whole region
//                   (overall structural context — not patch-graded; this term
//                   is meant to capture general scene match, not localize a
//                   defect)
//  2. color_tight — RGB histogram intersection on the inner 25 % crop, scored
//                   as a worst-percentile patch grid (TIGHT_GRID cells) rather
//                   than one number over the whole crop — see "Patch-grid
//                   aggregation" below
//  3. ssim_center — grayscale SSIM on the inner 50 % crop, also scored as a
//                   worst-percentile patch grid (CENTER_GRID cells)
//
// combined = 0.25 × ssim_full + 0.50 × color_tight + 0.25 × ssim_center
// PASS when combined ≥ PASS_THRESHOLD (env var, default 0.60)
//
// Why patch-grid instead of whole-region averaging for #2 and #3?
//   A single number averaged over an entire crop lets a small, localized
//   change (a missing/rotated/swapped part) get diluted by everything around
//   it that's unchanged — even within an already-tight ROI, the inspected
//   feature is rarely 100 % of the pixels. This was the root cause of
//   dual-state confidence clustering near ~50 % even on visually clear
//   pass/fail cases: simToPass and simToFail both landed high and nearly
//   equal because most of the crop matched in both comparisons regardless of
//   the part's actual state. Splitting into a small grid and aggregating via
//   the worst-scoring cells (not the mean) lets one bad region drag the score
//   down instead of being smoothed away.
//
// ROI-active tags use different inner sub-crop fractions, a wider/padded
// crop, and different weights (see ROI_*_FRAC, ROI_PADDING_FRAC, and the
// wFull/wColor/wCenter weights in scoreAgainstRefs) — the frame handed in is
// already a tight crop of the part, so re-applying the full-frame tuning
// on top of it was double-zooming and amplifying capture noise, which is
// what caused low validation scores on ROI-trained tags.
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

// Inner sub-crop fractions for the "center" (SSIM) and "tight" (colour
// histogram) metrics. These exist to zoom past an unchanged background that
// would otherwise dilute the signal — but that's only true for a FULL-FRAME
// capture. When an ROI is already active, the ROI crop has already done
// that job: the frame handed to decodeFrame is already just the inspected
// component (plus the padding margin below). Re-applying the same narrow
// 25 %/50 % inner crop on top of an already-tight ROI crop was the root
// cause of low ROI validation scores — it zoomed into a tiny sliver of the
// part, making the colour-histogram metric (50 % of the score) extremely
// sensitive to minor angle/distance/lighting drift between the trained
// reference and a live capture. When ROI is active we use much wider inner
// fractions so the metrics still see the whole part.
const FULLFRAME_MED_FRAC   = 0.50; // inner 50 % — today's full-frame behaviour
const FULLFRAME_TIGHT_FRAC = 0.25; // inner 25 % — today's full-frame behaviour
const ROI_MED_FRAC   = 0.90; // inner 90 % — ROI crop already isolated the part
const ROI_TIGHT_FRAC = 0.70; // inner 70 % — ROI crop already isolated the part

// Padding added around an Author-drawn ROI before cropping, as a fraction of
// the ROI's own width/height. Guards against the part being clipped by minor
// camera angle/position drift between the trained reference and a live
// Operator capture, which would otherwise tank the score for reasons
// unrelated to the part itself.
const ROI_PADDING_FRAC = 0.10;

function subCropBounds(frac: number): { start: number; end: number; w: number } {
  const margin = (1 - frac) / 2;
  const start  = Math.floor(SIZE * margin);
  const end    = SIZE - start;
  return { start, end, w: end - start };
}

// ── Patch-grid aggregation ───────────────────────────────────────────────────
// Whole-region averaging (one SSIM/histogram number over an entire crop)
// dilutes a small, localized change — a missing/rotated/swapped part — against
// a much larger area of unchanged background. That dilution is what was
// causing simToPass and simToFail to land high and nearly equal (driving
// dual-state confidence toward ~50%) even on test cases with a clearly
// different part state, because the inspected feature is rarely 100% of the
// pixels in even a tight crop. Splitting the center/tight crops into a small
// grid and aggregating via the worst-scoring cells (not the mean) lets a
// single bad region drag the score down instead of being smoothed away by
// everything around it that still matches.
const CENTER_GRID   = 4;    // 4×4 = 16 cells for the SSIM center-crop metric
const TIGHT_GRID    = 2;    // 2×2 = 4 cells for the colour-histogram metric —
                             // kept coarser than the SSIM grid because
                             // histogram intersection needs enough pixels per
                             // cell for BINS=64 to be meaningful; a finer grid
                             // here would add quantisation noise rather than
                             // real sensitivity.
const WORST_FRACTION = 0.5;  // aggregate = average of the worst 50% of cells —
                             // widened from 0.25 after field testing showed
                             // pure worst-quartile aggregation was intolerant
                             // of normal camera angle/distance drift: a single
                             // cell thrown off by viewpoint-driven parallax
                             // (not an actual part-state change) was enough to
                             // flip a PASS to a confident FAIL. Averaging over
                             // a larger share of cells dilutes one bad cell's
                             // influence while still weighting toward the
                             // worse-scoring half, so genuine multi-cell
                             // defects still get caught.

// ── Coarse translation registration (#83) ────────────────────────────────────
// WORST_FRACTION (above) widened the worst-percentile aggregate to tolerate
// viewpoint/parallax drift, but that's a dilution band-aid, not a fix: it
// just averages over more cells so one misaligned cell hurts less. The root
// problem is that a few pixels of camera shift between the trained reference
// and a live capture shifts WHERE the part's edges land in the patch grid,
// so cells that should compare "part vs part" end up comparing "part vs
// background" at the boundary — that's what produced near-identical
// combined scores (66% vs 68%) straddling the threshold on the same physical
// setup. Correcting that shift before grid scoring addresses it at the
// source instead of just softening the aggregation.
//
// Search is done on a small downsampled grayscale grid (cheap exhaustive SSD
// search), then the resulting integer (dx, dy) is applied to the live frame's
// full-resolution gray/center/tight arrays before any metric is computed.
// The search window is intentionally narrow (ALIGN_MAX_SHIFT_FRAC) — wide
// enough to absorb ordinary handheld camera jitter, far too narrow to let an
// actually-missing/different part "find" a shift that fakes a match.
const ALIGN_SEARCH_DS       = 32;   // downsampled side length used for the correlation search
const ALIGN_MAX_SHIFT_FRAC  = 0.06; // search window, as a fraction of SIZE, in each direction

function downsampleAvg(arr: Float32Array, width: number, dsN: number): Float32Array {
  const out = new Float32Array(dsN * dsN);
  const block = width / dsN;
  for (let by = 0; by < dsN; by++) {
    const r0 = Math.floor(by * block), r1 = Math.floor((by + 1) * block);
    for (let bx = 0; bx < dsN; bx++) {
      const c0 = Math.floor(bx * block), c1 = Math.floor((bx + 1) * block);
      let sum = 0, count = 0;
      for (let r = r0; r < r1; r++) {
        const rowBase = r * width;
        for (let c = c0; c < c1; c++) { sum += arr[rowBase + c]; count++; }
      }
      out[by * dsN + bx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

function ssdAtShift(ref: Float32Array, live: Float32Array, dsN: number, dx: number, dy: number): number {
  let sum = 0, n = 0;
  for (let r = 0; r < dsN; r++) {
    const sr = r + dy;
    if (sr < 0 || sr >= dsN) continue;
    const refRowBase = r * dsN, liveRowBase = sr * dsN;
    for (let c = 0; c < dsN; c++) {
      const sc = c + dx;
      if (sc < 0 || sc >= dsN) continue;
      const diff = ref[refRowBase + c] - live[liveRowBase + sc];
      sum += diff * diff; n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

// Returns the (dx, dy) full-resolution pixel shift that best aligns `live`
// onto `ref`, restricted to the narrow search window above.
function bestShift(refGray: Float32Array, liveGray: Float32Array, width: number): { dx: number; dy: number } {
  const dsN = ALIGN_SEARCH_DS;
  const refDs  = downsampleAvg(refGray, width, dsN);
  const liveDs = downsampleAvg(liveGray, width, dsN);
  const maxShiftDs = Math.max(1, Math.round(dsN * ALIGN_MAX_SHIFT_FRAC));

  let bestDx = 0, bestDy = 0, bestScore = Infinity;
  for (let dy = -maxShiftDs; dy <= maxShiftDs; dy++) {
    for (let dx = -maxShiftDs; dx <= maxShiftDs; dx++) {
      const score = ssdAtShift(refDs, liveDs, dsN, dx, dy);
      if (score < bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
    }
  }

  const scale = width / dsN;
  return { dx: Math.round(bestDx * scale), dy: Math.round(bestDy * scale) };
}

// Samples `arr` (a w×w array) shifted by (dx, dy), clamping at the border —
// equivalent to aligning `arr`'s content the way bestShift() measured it.
function shift2D(arr: Float32Array, w: number, dx: number, dy: number): Float32Array {
  if (dx === 0 && dy === 0) return arr;
  const out = new Float32Array(arr.length);
  for (let r = 0; r < w; r++) {
    let sr = r + dy;
    if (sr < 0) sr = 0; else if (sr >= w) sr = w - 1;
    const srcRowBase = sr * w, dstRowBase = r * w;
    for (let c = 0; c < w; c++) {
      let sc = c + dx;
      if (sc < 0) sc = 0; else if (sc >= w) sc = w - 1;
      out[dstRowBase + c] = arr[srcRowBase + sc];
    }
  }
  return out;
}

// Returns a copy of `live` with gray/center/tight content shifted to align
// onto `ref`. centerW/tightW are unchanged — the shift is in shared
// full-resolution pixel units, since center/tight are unscaled crops of the
// same SIZE×SIZE canvas as gray (see decodeFrame).
function alignLiveToRef(ref: DecodedFrame, live: DecodedFrame): DecodedFrame {
  const { dx, dy } = bestShift(ref.gray, live.gray, SIZE);
  if (dx === 0 && dy === 0) return live;
  return {
    gray:    shift2D(live.gray, SIZE, dx, dy),
    center:  shift2D(live.center, live.centerW, dx, dy),
    centerW: live.centerW,
    tightR:  shift2D(live.tightR, live.tightW, dx, dy),
    tightG:  shift2D(live.tightG, live.tightW, dx, dy),
    tightB:  shift2D(live.tightB, live.tightW, dx, dy),
    tightW:  live.tightW,
  };
}

function gridBounds(width: number, gridN: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= gridN; i++) pts.push(Math.round((i * width) / gridN));
  return pts;
}

function extractPatch(
  arr: Float32Array, width: number, r0: number, r1: number, c0: number, c1: number,
): Float32Array {
  const h = r1 - r0, w = c1 - c0;
  const out = new Float32Array(h * w);
  let k = 0;
  for (let r = r0; r < r1; r++) {
    const rowBase = r * width;
    for (let c = c0; c < c1; c++) out[k++] = arr[rowBase + c];
  }
  return out;
}

function worstPercentileAvg(scores: number[], frac: number): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const count  = Math.max(1, Math.round(sorted.length * frac));
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i];
  return sum / count;
}

function computeSSIMGrid(a: Float32Array, b: Float32Array, width: number, gridN: number): number {
  const pts = gridBounds(width, gridN);
  const scores: number[] = [];
  for (let gr = 0; gr < gridN; gr++) {
    for (let gc = 0; gc < gridN; gc++) {
      const r0 = pts[gr], r1 = pts[gr + 1], c0 = pts[gc], c1 = pts[gc + 1];
      if (r1 <= r0 || c1 <= c0) continue;
      scores.push(computeSSIM(
        extractPatch(a, width, r0, r1, c0, c1),
        extractPatch(b, width, r0, r1, c0, c1),
      ));
    }
  }
  return worstPercentileAvg(scores, WORST_FRACTION);
}

function histIntersection(ca: Float32Array, cb: Float32Array): number {
  const n  = ca.length;
  const bw = 256 / BINS;
  const hA = new Float32Array(BINS);
  const hB = new Float32Array(BINS);
  for (let i = 0; i < n; i++) {
    hA[Math.min(BINS - 1, Math.floor(ca[i] / bw))]++;
    hB[Math.min(BINS - 1, Math.floor(cb[i] / bw))]++;
  }
  let intersection = 0;
  for (let k = 0; k < BINS; k++) intersection += Math.min(hA[k], hB[k]);
  return intersection / n;
}

function computeTightColorHistGrid(
  a: DecodedFrame, b: DecodedFrame, width: number, gridN: number,
): number {
  const pts = gridBounds(width, gridN);
  const scores: number[] = [];
  for (let gr = 0; gr < gridN; gr++) {
    for (let gc = 0; gc < gridN; gc++) {
      const r0 = pts[gr], r1 = pts[gr + 1], c0 = pts[gc], c1 = pts[gc + 1];
      if (r1 <= r0 || c1 <= c0) continue;
      const cellScore = (
        histIntersection(
          extractPatch(a.tightR, width, r0, r1, c0, c1),
          extractPatch(b.tightR, width, r0, r1, c0, c1),
        ) +
        histIntersection(
          extractPatch(a.tightG, width, r0, r1, c0, c1),
          extractPatch(b.tightG, width, r0, r1, c0, c1),
        ) +
        histIntersection(
          extractPatch(a.tightB, width, r0, r1, c0, c1),
          extractPatch(b.tightB, width, r0, r1, c0, c1),
        )
      ) / 3;
      scores.push(cellScore);
    }
  }
  return worstPercentileAvg(scores, WORST_FRACTION);
}

// ── Decoded-frame type ────────────────────────────────────────────────────────

interface DecodedFrame {
  gray:    Float32Array; // grayscale BT.601, SIZE×SIZE
  center:  Float32Array; // grayscale medium crop, size depends on ROI-active fraction
  centerW: number;       // side length of the (square) center crop, for grid scoring
  tightR:  Float32Array; // R channel tight crop, size depends on ROI-active fraction
  tightG:  Float32Array; // G channel tight crop, size depends on ROI-active fraction
  tightB:  Float32Array; // B channel tight crop, size depends on ROI-active fraction
  tightW:  number;       // side length of the (square) tight crop, for grid scoring
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

// Optional normalised crop applied BEFORE the SIZE×SIZE resize. When present,
// every metric below (full-frame SSIM, center-crop SSIM, tight-crop colour
// histogram) operates only within this region instead of the whole frame —
// this is what lets a tag focus on the specific feature being inspected
// (a cable, a switch, a valve) rather than scoring the whole scene, where a
// missing/changed part is diluted by an otherwise-unchanged background.
// Absent ROI = today's full-frame behaviour, unchanged.
export interface ComparatorRoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

function roiKeySuffix(roi?: ComparatorRoi): string {
  if (!roi) return '';
  return `:roi:${roi.x.toFixed(4)},${roi.y.toFixed(4)},${roi.w.toFixed(4)},${roi.h.toFixed(4)}`;
}

// ── Bounded-concurrency decode pool ──────────────────────────────────────────
// Jimp.read() decodes a JPEG into a full native-resolution RGBA bitmap BEFORE
// resize(SIZE, SIZE) shrinks it down — for a multi-megapixel camera frame
// that's tens of MB held momentarily per image, even though the final cached
// DecodedFrame is tiny (~1.5MB of Float32Arrays). scoreAgainstRefs used to
// kick off every reference decode in one unbounded Promise.all, and
// compareDualState ran the Pass-side and Fail-side decode batches
// *concurrently* on top of that. With a Fail-state trained, a single
// validate-all call across N tags could trigger up to
// N × 2 states × ~14 images = 28N simultaneous full-resolution JPEG decodes —
// easily enough to blow past the 512MB instance limit in a momentary spike,
// even though every decoded frame is immediately downsized and (for
// references) cached. mapWithConcurrency caps how many decodes are in flight
// at once so peak memory stays roughly constant regardless of how many
// tags/images/states are involved in a given request.
const DECODE_CONCURRENCY = 4;

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function decodeFrame(base64: string, roi?: ComparatorRoi): Promise<DecodedFrame> {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const buf = Buffer.from(raw, 'base64');

  const img = await Jimp.read(buf);

  if (roi) {
    const nativeW = img.bitmap.width;
    const nativeH = img.bitmap.height;
    // Pad the Author-drawn box by ROI_PADDING_FRAC on every side before
    // cropping, so a live frame that's slightly rotated/shifted/closer than
    // the trained reference doesn't clip the part right at the ROI edge.
    const padW = roi.w * nativeW * ROI_PADDING_FRAC;
    const padH = roi.h * nativeH * ROI_PADDING_FRAC;
    const x1 = Math.max(0, roi.x * nativeW - padW);
    const y1 = Math.max(0, roi.y * nativeH - padH);
    const x2 = Math.min(nativeW, (roi.x + roi.w) * nativeW + padW);
    const y2 = Math.min(nativeH, (roi.y + roi.h) * nativeH + padH);
    const cx = Math.round(x1);
    const cy = Math.round(y1);
    const cw = Math.max(1, Math.round(x2 - x1));
    const ch = Math.max(1, Math.round(y2 - y1));
    img.crop(cx, cy, cw, ch);
  }

  // Resize preserving aspect ratio, then letterbox onto a neutral-gray
  // SIZE×SIZE canvas. A plain resize(SIZE, SIZE) stretches non-square crops
  // — virtually all ROI crops, and many full-frame ones — into a square,
  // distorting the part's proportions before every downstream metric runs.
  // This was a secondary contributor to the low ROI scores.
  const srcW  = img.bitmap.width;
  const srcH  = img.bitmap.height;
  const scale = Math.min(SIZE / srcW, SIZE / srcH);
  const fitW  = Math.max(1, Math.round(srcW * scale));
  const fitH  = Math.max(1, Math.round(srcH * scale));
  img.resize(fitW, fitH);           // keep colour — do NOT greyscale yet

  const canvas  = new Jimp(SIZE, SIZE, 0x808080ff);
  const offsetX = Math.floor((SIZE - fitW) / 2);
  const offsetY = Math.floor((SIZE - fitH) / 2);
  canvas.composite(img, offsetX, offsetY);

  // Inner sub-crop bounds for the "center"/"tight" metrics — wider when an
  // ROI is active, since the frame is already a tight crop of the part.
  const medFrac   = roi ? ROI_MED_FRAC   : FULLFRAME_MED_FRAC;
  const tightFrac = roi ? ROI_TIGHT_FRAC : FULLFRAME_TIGHT_FRAC;
  const med   = subCropBounds(medFrac);
  const tight = subCropBounds(tightFrac);

  const { data } = canvas.bitmap;  // RGBA Uint8Array, length = SIZE*SIZE*4
  const n = SIZE * SIZE;

  const gray   = new Float32Array(n);
  const center = new Float32Array(med.w * med.w);
  const tightR = new Float32Array(tight.w * tight.w);
  const tightG = new Float32Array(tight.w * tight.w);
  const tightB = new Float32Array(tight.w * tight.w);

  let ci = 0;  // center index
  let ti = 0;  // tight index

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const px = (row * SIZE + col) * 4;
      const r  = data[px];
      const g  = data[px + 1];
      const b  = data[px + 2];

      gray[row * SIZE + col] = 0.299 * r + 0.587 * g + 0.114 * b;

      if (row >= med.start && row < med.end && col >= med.start && col < med.end) {
        center[ci++] = gray[row * SIZE + col];
      }

      if (row >= tight.start && row < tight.end && col >= tight.start && col < tight.end) {
        tightR[ti]   = r;
        tightG[ti]   = g;
        tightB[ti++] = b;
      }
    }
  }

  return { gray, center, centerW: med.w, tightR, tightG, tightB, tightW: tight.w };
}

async function decodeReference(base64: string, roi?: ComparatorRoi): Promise<DecodedFrame> {
  const key    = refCacheKey(base64) + roiKeySuffix(roi);
  const cached = refCacheGet(key);
  if (cached) return cached;
  const frame = await decodeFrame(base64, roi);
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

// Shared scoring core — decodes the live frame once and every reference
// (cached), then returns the best (highest-combined-score) match. Used by
// both the single-reference absolute-threshold path (compareAgainstPassState)
// and the optional dual Pass/Fail nearest-match path (compareDualState).
async function scoreAgainstRefs(
  referenceBase64s: string[],
  liveFrame: DecodedFrame,
  roi?: ComparatorRoi,
): Promise<CompareResult> {
  if (referenceBase64s.length === 0) {
    return { score: 0, bestRefIndex: 0, details: [] };
  }

  const refFrames = await mapWithConcurrency(
    referenceBase64s,
    DECODE_CONCURRENCY,
    (ref, i) =>
      decodeReference(ref, roi).catch(err => {
        console.warn(`[comparator] Could not decode reference #${i}:`, err);
        return null;
      }),
  );

  let bestScore = -Infinity;
  let bestIndex = 0;
  const details: CompareResult['details'] = [];

  // Composite weights. Full-frame default: 50 % weight on tight-crop colour
  // — the key discriminator for part presence, since grayscale SSIM alone
  // can't distinguish e.g. an amber part from silver metal (similar
  // luminance) but the colour histogram in the tight crop can.
  //
  // When an ROI is active, the frame is already a tight crop of the part —
  // leaning so heavily on a colour histogram over an even-tighter inner
  // sub-crop (now widened, but still a crop of a crop) amplifies capture
  // noise (angle/distance/lighting drift) rather than detecting genuine
  // presence/absence. Shift weight toward the two SSIM terms, which are
  // more tolerant of that kind of variance.
  const wFull   = roi ? 0.35 : 0.25;
  const wColor  = roi ? 0.30 : 0.50;
  const wCenter = roi ? 0.35 : 0.25;

  for (let i = 0; i < refFrames.length; i++) {
    const ref = refFrames[i];
    if (!ref) {
      details.push({ ssimFull: 0, colorTight: 0, ssimCenter: 0, combined: 0 });
      continue;
    }

    // #83: coarsely re-align the live frame onto THIS reference before
    // scoring — each reference may have been trained from a slightly
    // different stance, so the correction is computed per-reference rather
    // than once against a single "canonical" pose.
    const aligned = alignLiveToRef(ref, liveFrame);

    const ssimFull   = computeSSIM(ref.gray, aligned.gray);
    const colorTight = computeTightColorHistGrid(ref, aligned, ref.tightW, TIGHT_GRID);
    const ssimCenter = computeSSIMGrid(ref.center, aligned.center, ref.centerW, CENTER_GRID);

    const combined = wFull * ssimFull + wColor * colorTight + wCenter * ssimCenter;

    details.push({ ssimFull, colorTight, ssimCenter, combined });

    if (combined > bestScore) {
      bestScore = combined;
      bestIndex = i;
    }
  }

  const finalScore = Math.max(0, bestScore);
  return { score: parseFloat(finalScore.toFixed(4)), bestRefIndex: bestIndex, details };
}

export async function compareAgainstPassState(
  referenceBase64s: string[],
  liveBase64: string,
  /** Optional per-call override; falls back to PASS_THRESHOLD env var → 0.60 */
  thresholdOverride?: number,
  /** Optional inspection-region crop — see ComparatorRoi. Absent = full frame (unchanged). */
  roi?: ComparatorRoi,
): Promise<CompareResult & { status: 'PASS' | 'FAIL' }> {
  const threshold =
    typeof thresholdOverride === 'number' && thresholdOverride > 0 && thresholdOverride <= 1
      ? thresholdOverride
      : parseFloat(process.env.PASS_THRESHOLD ?? '0.60');

  if (referenceBase64s.length === 0) {
    return { score: 0, bestRefIndex: 0, details: [], status: 'FAIL' };
  }

  // Live frame: always freshly decoded — never cached
  const liveFrame = await decodeFrame(liveBase64, roi);
  const { score, bestRefIndex, details } = await scoreAgainstRefs(referenceBase64s, liveFrame, roi);

  console.log(
    `[comparator] best ref #${bestRefIndex}: ` +
    `ssim=${details[bestRefIndex]?.ssimFull.toFixed(3)} ` +
    `color_tight=${details[bestRefIndex]?.colorTight.toFixed(3)} ` +
    `ssim_center=${details[bestRefIndex]?.ssimCenter.toFixed(3)} ` +
    `→ combined=${score.toFixed(3)} (threshold=${threshold}) ` +
    `→ ${score >= threshold ? 'PASS' : 'FAIL'}` +
    (roi ? ` [roi]` : ''),
  );

  return {
    score,
    bestRefIndex,
    details,
    status: score >= threshold ? 'PASS' : 'FAIL',
  };
}

// ── Dual-state (optional Fail-state) comparison ──────────────────────────────
// When an Author has also trained a Fail-state for a tag, this gives a
// relative ("nearest-match") decision instead of an absolute threshold:
// the live frame is scored against BOTH the Pass and Fail reference sets,
// and whichever it's more similar to wins. This is more robust than a single
// absolute threshold because a real fail condition doesn't need to look
// dramatically different from Pass in an absolute sense — it only needs to
// look more like the trained Fail example than the trained Pass example.
//
// Only called when failBase64s.length > 0; callers should fall back to
// compareAgainstPassState (today's behaviour) whenever no Fail-state exists.
export interface DualCompareResult {
  status: 'PASS' | 'FAIL';
  /** 0.0–1.0: confidence the live frame matches the WINNING side. */
  confidence: number;
  simToPass: number;
  simToFail: number;
}

export async function compareDualState(
  passBase64s: string[],
  failBase64s: string[],
  liveBase64: string,
  roi?: ComparatorRoi,
): Promise<DualCompareResult> {
  const liveFrame = await decodeFrame(liveBase64, roi);

  // Sequential, not Promise.all — scoreAgainstRefs already decodes its own
  // reference batch with bounded concurrency (DECODE_CONCURRENCY); running
  // the Pass-side and Fail-side batches concurrently on top of that would
  // double the number of simultaneous full-resolution JPEG decodes for every
  // tag that has a Fail-state trained, which is exactly the spike that was
  // driving the server OOM.
  const passResult = await scoreAgainstRefs(passBase64s, liveFrame, roi);
  const failResult = await scoreAgainstRefs(failBase64s, liveFrame, roi);

  const simToPass = passResult.score;
  const simToFail = failResult.score;
  const denom = simToPass + simToFail;
  // Margin-based confidence: how much closer the live frame is to the winning
  // reference set, normalised to 0.0–1.0. Falls back to 0.5 (no signal) if
  // both sides scored exactly zero (e.g. totally unrelated frame).
  const confidence = denom > 0 ? Math.max(simToPass, simToFail) / denom : 0.5;
  const status: 'PASS' | 'FAIL' = simToPass >= simToFail ? 'PASS' : 'FAIL';

  console.log(
    `[comparator] dual-state: simToPass=${simToPass.toFixed(3)} simToFail=${simToFail.toFixed(3)} ` +
    `→ ${status} (confidence=${confidence.toFixed(3)})` + (roi ? ` [roi]` : ''),
  );

  return { status, confidence: parseFloat(confidence.toFixed(4)), simToPass, simToFail };
}
