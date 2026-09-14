// gemba/library-core.ts — Audit Reference Library: pure validation, import
// planning and the seed. No I/O here; routes/gemba-library.ts owns the stores.
//
// Why a library at all (G1, 2026.4.46): the PowerApps Gemba Audit tool bound
// its pickers to SharePoint reference lists — Focus Area → Question → finding.
// Auditors never typed a category; they chose one, so findings roll up
// cleanly. This module is that vocabulary, owned by Corporate Quality via
// the portal, consumed by iOS in one GET.
//
// Codes are the stable identity across imports (an xlsx re-import updates
// the row with the same code instead of duplicating it); ids are internal.

import type {
  GembaFocusArea, GembaQuestion, GembaFindingCategory, GembaRiskRating, GembaLibraryImport, GembaListKind, GembaLists,
} from '@spatial/shared';

export class GembaValidationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export const GEMBA_FINDING_CATEGORIES: readonly { code: GembaFindingCategory; label: string }[] = [
  { code: 'STRENGTH', label: 'Strength' },
  { code: 'OFI',      label: 'OFI — Opportunity for Improvement' },
  { code: 'NC',       label: 'NC — Non-Conformance' },
];

export const GEMBA_RISK_RATINGS: readonly { value: GembaRiskRating; label: string }[] = [
  { value: 0, label: '0 — No risk' },
  { value: 1, label: '1 — Minor risk' },
  { value: 2, label: '2 — Medium risk' },
  { value: 3, label: '3 — High risk' },
];

export function isFindingCategory(v: unknown): v is GembaFindingCategory {
  return typeof v === 'string' && GEMBA_FINDING_CATEGORIES.some(c => c.code === v);
}
export function isRiskRating(v: unknown): v is GembaRiskRating {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

// ── Field validation ────────────────────────────────────────────────────────

const MAX_CODE = 24, MAX_TITLE = 120, MAX_TEXT = 2000;

/** Codes compare case-insensitively and whitespace-trimmed ("p5142" == "P5142"). */
export function normCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export interface FocusAreaInput { code: string; title: string; order?: number; active?: boolean }
export interface QuestionInput  { code: string; title: string; text: string; order?: number; active?: boolean }

export function validateFocusArea(raw: unknown, where = 'Focus area'): FocusAreaInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = normCode(r.code);
  if (!code) throw new GembaValidationError(400, `${where}: code is required (e.g. "14").`);
  if (code.length > MAX_CODE) throw new GembaValidationError(400, `${where}: code too long.`);
  const title = str(r.title, MAX_TITLE);
  if (!title) throw new GembaValidationError(400, `${where} ${code}: title is required.`);
  const out: FocusAreaInput = { code, title };
  if (typeof r.order === 'number' && Number.isFinite(r.order)) out.order = r.order;
  if (typeof r.active === 'boolean') out.active = r.active;
  return out;
}

export function validateQuestion(raw: unknown, where = 'Question'): QuestionInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const code = normCode(r.code);
  if (!code) throw new GembaValidationError(400, `${where}: code is required (e.g. "P5142").`);
  if (code.length > MAX_CODE) throw new GembaValidationError(400, `${where}: code too long.`);
  const text = str(r.text, MAX_TEXT);
  if (!text) throw new GembaValidationError(400, `${where} ${code}: question text is required.`);
  const title = str(r.title, MAX_TITLE) || text.slice(0, 60);
  const out: QuestionInput = { code, title, text };
  if (typeof r.order === 'number' && Number.isFinite(r.order)) out.order = r.order;
  if (typeof r.active === 'boolean') out.active = r.active;
  return out;
}

// ── Import planning ─────────────────────────────────────────────────────────
// Validates the whole payload first (so a bad row 40 never leaves rows 1–39
// half-applied), then produces the exact list of saves. The route applies it.

export interface ImportPlan {
  mode: 'append' | 'replace';
  focusAreas: { input: FocusAreaInput; existing?: GembaFocusArea; questions: { input: QuestionInput; existing?: GembaQuestion }[] }[];
  counts: { areasNew: number; areasUpdated: number; questionsNew: number; questionsUpdated: number };
}

export function planImport(
  raw: unknown,
  existingAreas: GembaFocusArea[],
  existingQuestions: GembaQuestion[],
): ImportPlan {
  const body = (raw ?? {}) as Partial<GembaLibraryImport>;
  const mode = body.mode === 'replace' ? 'replace' : 'append';
  if (!Array.isArray(body.focusAreas) || body.focusAreas.length === 0) {
    throw new GembaValidationError(400, 'Provide a non-empty focusAreas array.');
  }
  const areaByCode = new Map(existingAreas.map(a => [a.code, a]));
  const qByCode    = new Map(existingQuestions.map(q => [q.code, q]));
  const seenAreas = new Set<string>(), seenQs = new Set<string>();
  const counts = { areasNew: 0, areasUpdated: 0, questionsNew: 0, questionsUpdated: 0 };

  const focusAreas = body.focusAreas.map((fa, i) => {
    const input = validateFocusArea(fa, `Row ${i + 1}`);
    if (seenAreas.has(input.code)) throw new GembaValidationError(400, `Focus area code "${input.code}" appears twice in the import.`);
    seenAreas.add(input.code);
    if (input.order === undefined) input.order = i + 1;
    const existing = mode === 'append' ? areaByCode.get(input.code) : undefined;
    existing ? counts.areasUpdated++ : counts.areasNew++;

    const rawQs = Array.isArray((fa as { questions?: unknown }).questions) ? (fa as { questions: unknown[] }).questions : [];
    const questions = rawQs.map((q, j) => {
      const qi = validateQuestion(q, `Focus area ${input.code}, question ${j + 1}`);
      if (seenQs.has(qi.code)) throw new GembaValidationError(400, `Question code "${qi.code}" appears twice in the import.`);
      seenQs.add(qi.code);
      if (qi.order === undefined) qi.order = j + 1;
      const qExisting = mode === 'append' ? qByCode.get(qi.code) : undefined;
      qExisting ? counts.questionsUpdated++ : counts.questionsNew++;
      return { input: qi, existing: qExisting };
    });
    return { input, existing, questions };
  });
  return { mode, focusAreas, counts };
}

/**
 * Flat rows (one per question, focus-area columns repeated) → import payload.
 * This is what the portal's xlsx/CSV parser produces; also accepted directly
 * by POST /gemba/library/import as `{ rows: [...] }` for scripted loads.
 * A row with a focus area but no question code adds just the area.
 */
export interface FlatRow { areaCode?: unknown; areaTitle?: unknown; code?: unknown; title?: unknown; text?: unknown }
export function rowsToImport(rows: FlatRow[], mode: 'append' | 'replace' = 'append'): GembaLibraryImport {
  const areas = new Map<string, { code: string; title: string; questions: { code: string; title?: string; text: string }[] }>();
  rows.forEach((r, i) => {
    const areaCode = normCode(r.areaCode);
    if (!areaCode) throw new GembaValidationError(400, `Row ${i + 1}: focus area code is missing.`);
    let area = areas.get(areaCode);
    if (!area) {
      area = { code: areaCode, title: str(r.areaTitle, MAX_TITLE), questions: [] };
      areas.set(areaCode, area);
    } else if (!area.title && r.areaTitle) {
      area.title = str(r.areaTitle, MAX_TITLE);
    }
    const qCode = normCode(r.code);
    if (qCode) area.questions.push({ code: qCode, title: str(r.title, MAX_TITLE) || undefined, text: str(r.text, MAX_TEXT) });
  });
  return { mode, focusAreas: [...areas.values()] };
}

// ── Seed ────────────────────────────────────────────────────────────────────
// The 15 focus areas from Corporate Quality's Gemba Audit tool. Questions are
// NOT seeded — they arrive via import. Applied on an empty store; on a
// server that was seeded earlier, any missing area is added (by code) and
// the four demo 6S questions from the first seed are removed if untouched.

export const SEED_FOCUS_AREAS: readonly { code: string; title: string }[] = [
  { code: '1',  title: 'Quality policy awareness' },
  { code: '2',  title: 'QMS awareness (relevant documents)' },
  { code: '3',  title: 'Cleanroom Protocols / Particle Reduction' },
  { code: '4',  title: 'Incoming Materials Control to Mfg' },
  { code: '5',  title: 'Product Identification and Traceability' },
  { code: '6',  title: 'Manufacturing Training and Certification' },
  { code: '7',  title: 'Build process controls (OMS, ESD, ESW, crossover, QN\'s)' },
  { code: '8',  title: 'Test process controls (OMS, ESW, SPC/Yield, QN\'s)' },
  { code: '9',  title: 'Test Statistical Process Control' },
  { code: '10', title: 'Non-Conforming Materials' },
  { code: '11', title: 'Calibration' },
  { code: '12', title: 'Preventive Maintenance' },
  { code: '13', title: 'Shelf Life Management' },
  { code: '14', title: '6S Audits' },
  { code: '15', title: 'Shipment Release and Controls' },
];

/** Demo questions shipped with the first seed — removed by the seed upgrade when untouched. */
export const LEGACY_SEED_QUESTIONS: readonly { code: string; text: string }[] = [
  { code: 'P5141', text: 'Ask people whether they know where the 6S procedure is and what it requires of their area.' },
  { code: 'P5142', text: 'Ask people to explain the 6S program to you in their own words (check for understanding of concepts).' },
  { code: 'P5143', text: 'Check and see if 6S audits are taking place and review results for alignment with actual environment.' },
  { code: 'P5144', text: 'Check how 6S results and actions are communicated to the area and followed up.' },
];

export function buildSeedLibrary(): GembaLibraryImport {
  return { mode: 'replace', focusAreas: SEED_FOCUS_AREAS.map(a => ({ ...a })) };
}

// ── Walk-header pick lists (G2) ─────────────────────────────────────────────

export const GEMBA_LIST_KINDS: readonly GembaListKind[] = ['organization', 'bu', 'area', 'location'];
export const EMPTY_LISTS: GembaLists = { organization: [], bu: [], area: [], location: [] };
const MAX_LIST_ITEMS = 200, MAX_LIST_ITEM = 80;

export function isListKind(v: unknown): v is GembaListKind {
  return typeof v === 'string' && (GEMBA_LIST_KINDS as readonly string[]).includes(v);
}

/** Trim, drop empties, de-duplicate case-insensitively (first spelling wins), cap. */
export function validateListValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new GembaValidationError(400, 'values must be an array of strings.');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const t = typeof v === 'string' ? v.trim().slice(0, MAX_LIST_ITEM) : '';
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

/** Seed pick lists — what the PowerApps tool showed; Corporate Quality edits in the portal. */
export function buildSeedLists(): GembaLists {
  return {
    organization: ['AGS', 'SPG', 'DSG'],
    bu:           ['Headsmart, DDP, PDC'],
    area:         ['Others'],
    location:     ['Montana', 'Austin', 'Singapore'],
  };
}
