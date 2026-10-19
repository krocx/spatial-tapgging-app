// oms/assertions.ts - readings and text checks as pure functions (AROMS-332).
//
//   parseExpectation  the ME's "80 Ω ±5 %" / "12.0 N·m ± 0.5" / "≤ 1.0e-9 mbar·l/s"
//                     / "20-24 psi" / "≥ 20 psi" → { min, max, unit }
//   parseReading      the text Vision read on a display → the number in it
//   evaluate          one assertion against what was read → verdict in words
//
// No I/O. The roadmap client imports this file relatively (as it does
// procedure/sections.ts) so the Designer previews the same bounds the
// operator is judged by. Proprietary & Confidential · Applied Materials.

import type { StepAssertion } from '@spatial/shared';

export interface Bounds { min?: number; max?: number; unit?: string }

const NUM = '[-+]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)(?:[eE][-+]?\\d+)?';
const num = (t: string) => Number(t.replace(',', '.'));

/** Normalise unicode variants the ME may type: µ/μ, Ω/ohm, ·/*, fancy minus. */
function normalise(text: string): string {
  return text.replace(/[−–]/g, '-').replace(/μ/g, 'µ').replace(/\bohms?\b/gi, 'Ω').replace(/\s*\*\s*/g, '·').replace(/\s+/g, ' ').trim();
}

/**
 * The expectation in the work instruction's own form → comparison bounds.
 * Forms (unit optional, anywhere after the numbers):
 *   "80 Ω ±5 %"  "80 ±4 Ω"  "80 +/- 4"      → centre ± absolute or percent
 *   "20-24 psi"  "20 to 24 psi"  "20…24"      → range
 *   "<= 1.0e-9 mbar·l/s"  "≤ 1e-9"  "max 5"   → upper bound only
 *   ">= 20 psi"  "≥ 20"  "min 20"             → lower bound only
 *   "80 Ω"                                     → exact (min = max)
 * Returns null when no number is found.
 */
export function parseExpectation(raw: string): Bounds | null {
  const t = normalise(raw);
  const unitOf = (rest: string) => { const u = rest.replace(new RegExp(NUM, 'g'), '').replace(/[±%]|\+\/-|\bto\b|…|\.\.\.|[-<>=≤≥]|\bmax(?:imum)?\b|\bmin(?:imum)?\b|\bat (?:most|least)\b/gi, '').replace(/\s+/g, ' ').trim(); return u || undefined; };
  let m: RegExpMatchArray | null;
  // "80 Ω ±5 %" · "80 ±4 Ω" · "12.0 N·m ± 0.5" · "80 +/- 4": the unit may sit before or after the tolerance.
  if ((m = t.match(new RegExp(`^(${NUM})\\s*([^±+]*?)\\s*(?:±|\\+\\/-)\\s*(${NUM})\\s*(%?)\\s*(.*)$`)))) {
    const c = num(m[1]); const d = num(m[3]); const tol = m[4] === '%' ? Math.abs(c) * d / 100 : d;
    return { min: c - tol, max: c + tol, unit: unitOf(`${m[2]} ${m[5]}`) };
  }
  if ((m = t.match(new RegExp(`^(${NUM})\\s*(?:-|to|…|\\.\\.\\.)\\s*(${NUM})\\s*(.*)$`)))) {
    const a = num(m[1]); const b = num(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b), unit: unitOf(m[3]) };
  }
  if ((m = t.match(new RegExp(`^(?:<=|≤|<|max(?:imum)?|at most)\\s*(${NUM})\\s*(.*)$`, 'i')))) return { max: num(m[1]), unit: unitOf(m[2]) };
  if ((m = t.match(new RegExp(`^(?:>=|≥|>|min(?:imum)?|at least)\\s*(${NUM})\\s*(.*)$`, 'i')))) return { min: num(m[1]), unit: unitOf(m[2]) };
  if ((m = t.match(new RegExp(`^(${NUM})\\s*(.*)$`)))) { const v = num(m[1]); return { min: v, max: v, unit: unitOf(m[2]) }; }
  return null;
}

const SUPERS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

/**
 * AROMS-342: what instrument displays print for "× 10 to the", folded to "E":
 * superscript digits and minus ("1.2×10⁻⁹"), "x10^-9", "x10-9", "·10-9",
 * "E -09" and "e-9". The iPad (ReadingJudge.normaliseNotation) does the same.
 */
export function normaliseNotation(text: string): string {
  let t = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, ch => SUPERS[ch] ?? ch).replace(/[−–—]/g, '-');
  t = t.replace(/\s*[x×X·*]\s*10\s*\^?\s*([-+]?\d+)/g, 'E$1');
  t = t.replace(/[eE]\s*([-+]?)\s*(\d+)/g, 'E$1$2');
  return t;
}

/** The number on a display, from what the recogniser read ("79.6 Ω", "OL", "1.2e-9", "1.2×10⁻⁹ mbar·l/s"). Null when none. */
export function parseReading(text: string): number | null {
  const t = normalise(normaliseNotation(text));
  const m = t.match(new RegExp(NUM));
  if (!m) return null;
  const v = num(m[0]);
  return Number.isFinite(v) ? v : null;
}

const fold = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export interface AssertionResult {
  id: string; kind: StepAssertion['kind']; pass: boolean;
  /** What was read, as read. */
  read: string;
  /** The parsed number for text-value. */
  value?: number;
  /** The verdict in words, for the step panel and the run record. */
  words: string;
  onFail: StepAssertion['onFail'];
}

/** Judge one assertion against what the operator's device read. */
export function evaluate(a: StepAssertion, read: string): AssertionResult {
  const base = { id: a.id, kind: a.kind, read, onFail: a.onFail };
  if (a.kind === 'text-value') {
    const v = parseReading(read);
    const unit = a.unit ? ` ${a.unit}` : '';
    if (v === null) return { ...base, pass: false, words: `No reading found in "${read}" - expected ${a.expected}` };
    const lo = a.min === undefined || v >= a.min; const hi = a.max === undefined || v <= a.max;
    const pass = lo && hi;
    return { ...base, pass, value: v, words: pass ? `Read ${v}${unit} - within ${a.expected}` : `Read ${v}${unit} - outside ${a.expected}` };
  }
  const got = fold(read); const want = fold(a.expected);
  // AROMS-349: a blank expectation is a configuration slip, never a wall - flagged, not blocking.
  if (!want) return { ...base, pass: false, onFail: 'flag', words: 'No expected text on this step - skipped (the author types it on the step)' };
  let pass = false;
  switch (a.match ?? 'contains') {           // "must say", not "says only" (AROMS-349)
    case 'exact':    pass = got === want; break;
    case 'any-of':   pass = want.split(/\s*[|,;]\s*/).filter(Boolean).some(w => got === w || got.includes(w)); break;
    case 'regex':    try { pass = new RegExp(a.expected, 'i').test(read); } catch { pass = false; } break;
    default:         pass = got.includes(want); break;
  }
  const what = a.kind === 'code' ? 'Barcode' : 'Read';   // the kind stays `code` on the wire; people say barcode
  if (pass) return { ...base, pass, words: `${what} "${a.expected}" - found` };
  return { ...base, pass, words: got ? `${what} "${read}" - "${a.expected}" not on it` : `Nothing readable in the frame - expected "${a.expected}"` };
}

/** Fill min/max/unit from `expected` for text-value assertions that lack them (authoring helper). */
export function withBounds(a: StepAssertion): StepAssertion {
  if (a.kind !== 'text-value') return a;
  const b = parseExpectation(a.expected);
  if (!b) return a;
  return { ...a, min: a.min ?? b.min, max: a.max ?? b.max, unit: a.unit ?? b.unit };
}

/** The step's verdict: every blocking assertion passed. Flagged misses are reported, not blocking. */
export function stepVerdict(results: AssertionResult[]): { pass: boolean; blocked: AssertionResult[]; flagged: AssertionResult[] } {
  const blocked = results.filter(r => !r.pass && r.onFail === 'block');
  const flagged = results.filter(r => !r.pass && r.onFail === 'flag');
  return { pass: blocked.length === 0, blocked, flagged };
}

/** A client's assertion list → a clean one (unknown kinds dropped, ids kept or minted, bounds filled). Empty → undefined. */
export function sanitizeAssertions(raw: unknown): StepAssertion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StepAssertion[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const kind = r.kind;
    if (kind !== 'text-match' && kind !== 'text-value' && kind !== 'code' && kind !== 'location') continue;
    const expected = typeof r.expected === 'string' ? r.expected.trim() : '';
    if (!expected && kind !== 'location') continue;
    const a: StepAssertion = {
      id: typeof r.id === 'string' && r.id ? r.id : `as-${Math.random().toString(36).slice(2, 10)}`,
      kind, expected,
      onFail: r.onFail === 'flag' ? 'flag' : 'block',
      source: r.source === 'import' ? 'import' : 'author',
    };
    if (typeof r.unit === 'string' && r.unit.trim()) a.unit = r.unit.trim();
    if (typeof r.min === 'number' && Number.isFinite(r.min)) a.min = r.min;
    if (typeof r.max === 'number' && Number.isFinite(r.max)) a.max = r.max;
    if (r.match === 'exact' || r.match === 'contains' || r.match === 'any-of' || r.match === 'regex') a.match = r.match;
    if (r.instrument === 'multimeter' || r.instrument === 'torque' || r.instrument === 'leak-check' || r.instrument === 'other') a.instrument = r.instrument;
    const g = r.region as Record<string, unknown> | undefined;
    if (g && ['x', 'y', 'w', 'h'].every(k => typeof g[k] === 'number')) a.region = { x: g.x as number, y: g.y as number, w: g.w as number, h: g.h as number };
    out.push(withBounds(a));
  }
  // AROMS-349: a position with no label text left to anchor it goes with the blank check.
  const kept = out.some(a => a.kind === 'text-match') ? out : out.filter(a => a.kind !== 'location');
  return kept.length ? kept : undefined;
}
