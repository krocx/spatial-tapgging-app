// inspection-logger.ts
//
// Appends one InspectionLogEntry to .sib-data/inspection-logs.json after every
// validate-all call.  The schema is intentionally flat and cloud-ready:
// each entry maps directly to a row in a future "inspection_sessions" DB table.
//
// Future web dashboard path:
//   GET /admin/inspection-logs  — paginated list
//   GET /admin/inspection-logs/:id — full detail with per-tag scores
//
// Data privacy note (roadmap):
//   imageBase64 payloads are NOT stored in logs.  Only scores and metadata are
//   retained.  When migrating to cloud, apply AES-256 encryption at rest and
//   TLS 1.3 in transit (see CLOUD-MIGRATION-SPEC.md).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { AnchorStatus, ValidationStatus, TagType } from '@spatial/shared';

// ── Log entry schema ──────────────────────────────────────────────────────────

export interface InspectionTagResult {
  tagId:      string;
  tagLabel:   string;
  tagType:    TagType;
  status:     ValidationStatus;
  confidence: number;           // 0.0 – 1.0 (combined comparator score)
}

export interface InspectionLogEntry {
  id:            string;        // UUID — maps to PK in future DB
  sessionId:     string;        // SIB session that triggered this inspection
  anchorId:      string;
  assetId:       string;
  operatorIP:    string;        // request.ip — for audit trail
  threshold:     number;        // PASS threshold used for this run
  startedAt:     string;        // ISO 8601 — when validate-all was called
  durationMs:    number;        // wall-clock time for the full comparison run
  overallStatus: AnchorStatus;
  passCount:     number;
  failCount:     number;
  pendingCount:  number;
  totalCount:    number;
  tagResults:    InspectionTagResult[];
}

// ── Storage path ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
// SIB_DATA_DIR env var allows overriding the data location (e.g. Render persistent disk).
const DATA_DIR  = process.env.SIB_DATA_DIR ?? join(__dirname, '../../.sib-data');
const LOG_FILE  = join(DATA_DIR, 'inspection-logs.json');

function loadLogs(): InspectionLogEntry[] {
  if (!existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(readFileSync(LOG_FILE, 'utf-8')) as InspectionLogEntry[];
  } catch {
    return [];
  }
}

function saveLogs(logs: InspectionLogEntry[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append one inspection record to the log file.
 * Call this at the end of every successful validate-all response.
 */
export function logInspection(entry: Omit<InspectionLogEntry, 'id'>): InspectionLogEntry {
  const record: InspectionLogEntry = { id: uuidv4(), ...entry };
  const logs = loadLogs();
  logs.push(record);
  saveLogs(logs);
  console.log(
    `[logger] Inspection logged: id=${record.id} anchor=${record.anchorId} ` +
    `${record.overallStatus} (${record.passCount}/${record.totalCount}) ` +
    `${record.durationMs}ms threshold=${record.threshold}`,
  );
  return record;
}

/**
 * Return all log entries, newest first.
 * Used by future GET /admin/inspection-logs endpoint.
 */
export function getAllLogs(): InspectionLogEntry[] {
  return loadLogs().reverse();
}

/**
 * Return entries for a specific anchor, newest first.
 */
export function getLogsByAnchor(anchorId: string): InspectionLogEntry[] {
  return loadLogs()
    .filter(e => e.anchorId === anchorId)
    .reverse();
}
