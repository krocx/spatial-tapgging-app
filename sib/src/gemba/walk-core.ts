// gemba/walk-core.ts - G2: walk session validation + summary (pure).
//
// A walk is the header the PowerApps tool collected before the first
// finding - who, Project ID, Organization, BU, Area, Location - plus start /
// submit times. Findings reference it by `walkId`; the summary is derived on
// read so it can never drift from the findings.

import type { GembaWalk, GembaWalkSummary, StartGembaWalkRequest, LocTag, GembaRiskRating } from '@spatial/shared';
import { GembaValidationError } from './library-core.js';

const MAX_SHORT = 80, MAX_NOTES = 2000;

function short(v: unknown, max = MAX_SHORT): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

export function validateStartWalk(raw: unknown): StartGembaWalkRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const anchorId = short(r.anchorId, 120);
  if (!anchorId) throw new GembaValidationError(400, 'anchorId is required.');
  const auditorName = short(r.auditorName);
  if (!auditorName) throw new GembaValidationError(400, 'auditorName is required.');
  return {
    anchorId, auditorName,
    auditorId:    short(r.auditorId, 40),
    projectId:    short(r.projectId),
    organization: short(r.organization),
    bu:           short(r.bu),
    area:         short(r.area),
    location:     short(r.location),
  };
}

/** PATCH: same header fields, all optional; empty string clears. */
export function validateWalkPatch(raw: unknown): Partial<Pick<GembaWalk, 'projectId' | 'organization' | 'bu' | 'area' | 'location' | 'notes' | 'auditorName'>> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, string | undefined> = {};
  for (const k of ['projectId', 'organization', 'bu', 'area', 'location', 'auditorName'] as const) {
    if (k in r) out[k] = short(r[k]);
  }
  if ('notes' in r) out.notes = short(r.notes, MAX_NOTES);
  if (out.auditorName === undefined && 'auditorName' in r) throw new GembaValidationError(400, 'auditorName cannot be empty.');
  return out;
}

export function summarize(findings: LocTag[]): GembaWalkSummary {
  const s: GembaWalkSummary = { findings: findings.length, strength: 0, ofi: 0, nc: 0, uncategorised: 0, photos: 0 };
  let maxRisk: GembaRiskRating | undefined;
  for (const f of findings) {
    switch (f.findingCategory) {
      case 'STRENGTH': s.strength++; break;
      case 'OFI':      s.ofi++; break;
      case 'NC':       s.nc++; break;
      default:         s.uncategorised++;
    }
    if (f.riskRating !== undefined && (maxRisk === undefined || f.riskRating > maxRisk)) maxRisk = f.riskRating;
    s.photos += f.photos?.length ?? (f.referenceImagePath ? 1 : 0);
  }
  if (maxRisk !== undefined) s.maxRisk = maxRisk;
  return s;
}

/** One line for the completion toast / summary screen. */
export function summaryLine(s: GembaWalkSummary): string {
  const parts = [`${s.findings} finding${s.findings === 1 ? '' : 's'}`];
  if (s.strength) parts.push(`${s.strength} strength`);
  if (s.ofi)      parts.push(`${s.ofi} OFI`);
  if (s.nc)       parts.push(`${s.nc} NC`);
  if (s.maxRisk !== undefined && s.maxRisk > 0) parts.push(`max risk ${s.maxRisk}`);
  return parts.join(' · ');
}
