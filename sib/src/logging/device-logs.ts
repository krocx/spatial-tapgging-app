// device-logs.ts — QA logging: what the phones (and this server) say, on disk.
//
// A work iPhone cannot hand over its console, so the app ships its log lines
// here in small batches (iOS `AppLog`). Lines are appended as JSONL under
//   DATA_DIR/logs/YYYY-MM-DD/<deviceId>.jsonl      (one file per device per day)
//   DATA_DIR/logs/YYYY-MM-DD/server.jsonl          (this process's console)
// so a device and the server line up on one timeline. Rotation is by day,
// retention LOG_RETENTION_DAYS (default 14). The folder lives inside the
// data root — covered by the backup tarball, never in git.
//
// Levels: debug < info < warn < error. The app sends debug only with QA Mode
// on; the server keeps whatever arrives. Nothing here is a system of record —
// it is a trace for finding bugs, bounded and prunable.
//
// Redaction happens on the phone (keys, tokens, base64 blobs) and again here
// as a belt-and-braces pass so a careless log line can't park a secret on disk.

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { DATA_DIR } from '../data-dir.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export interface DeviceInfo {
  id:          string;          // stable per install (app-generated UUID)
  model?:      string;          // "iPhone17,2"
  os?:         string;          // "iOS 26.5"
  app?:        string;          // "2026.4.46"
  employeeId?: string;
  name?:       string;          // display name if known
  qaMode?:     boolean;
}

export interface LogEntry {
  ts:      string;              // ISO 8601, device clock
  level:   LogLevel;
  module:  string;              // model | object | presence | cone | guide | net | ui | app | server
  msg:     string;
  ctx?:    Record<string, string | number | boolean | null>;
}

/** Stored line = entry + device identity (flattened for grep-ability). */
export interface StoredLine extends LogEntry {
  device:   string;
  rx:       string;             // server receive time
  emp?:     string;
  app?:     string;
  qa?:      boolean;
}

export interface LogBatch { device: DeviceInfo; entries: LogEntry[] }

export const MAX_BATCH   = 500;
export const MAX_MSG     = 2000;
export const MAX_CTX_KEYS = 24;

const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const logEvents = new EventEmitter();
logEvents.setMaxListeners(100);

// ── Redaction ────────────────────────────────────────────────────────────────
// Anything that looks like a key/token/long base64 run is replaced. Applied
// to msg and ctx values. Deliberately blunt.
export function redact(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/((?:api|admin|ip|aes|enc(?:ryption)?)[_-]?key"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/(?:[A-Za-z0-9+/]{4}){20,}={0,2}/g, m => `[redacted:b64:${m.length}]`)   // base64 ≥ 80 chars
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, m => `[redacted:${m.length}]`);              // long opaque tokens (UUIDs are 36)
}

// ── Validation (pure, unit-tested) ───────────────────────────────────────────

export function validateLogBatch(body: unknown): { ok: true; value: LogBatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const d = b.device as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id.trim()) return { ok: false, error: 'device.id is required' };
  if (!Array.isArray(b.entries)) return { ok: false, error: 'entries must be an array' };
  if (b.entries.length === 0) return { ok: false, error: 'entries is empty' };
  if (b.entries.length > MAX_BATCH) return { ok: false, error: `entries exceeds ${MAX_BATCH}` };

  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const device: DeviceInfo = { id: d.id.trim().replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) };
  const model = str(d.model, 40); if (model) device.model = model;
  const os = str(d.os, 40); if (os) device.os = os;
  const app = str(d.app, 24); if (app) device.app = app;
  const emp = str(d.employeeId, 40); if (emp) device.employeeId = emp;
  const name = str(d.name, 80); if (name) device.name = name;
  if (typeof d.qaMode === 'boolean') device.qaMode = d.qaMode;

  const entries: LogEntry[] = [];
  for (const raw of b.entries as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const level = typeof e.level === 'string' && (LOG_LEVELS as readonly string[]).includes(e.level) ? e.level as LogLevel : 'info';
    const msg = typeof e.msg === 'string' ? e.msg : '';
    if (!msg.trim()) continue;
    const tsNum = typeof e.ts === 'string' ? Date.parse(e.ts) : NaN;
    const ts = Number.isFinite(tsNum) ? new Date(tsNum).toISOString() : new Date().toISOString();
    const module = (typeof e.module === 'string' && e.module.trim() ? e.module.trim() : 'app').toLowerCase().slice(0, 24);
    const entry: LogEntry = { ts, level, module, msg: redact(msg.slice(0, MAX_MSG)) };
    if (e.ctx && typeof e.ctx === 'object') {
      const ctx: NonNullable<LogEntry['ctx']> = {};
      let n = 0;
      for (const [k, v] of Object.entries(e.ctx as Record<string, unknown>)) {
        if (n++ >= MAX_CTX_KEYS) break;
        if (v === null || typeof v === 'boolean' || typeof v === 'number') ctx[k.slice(0, 32)] = v as number | boolean | null;
        else if (typeof v === 'string') ctx[k.slice(0, 32)] = redact(v.slice(0, 300));
      }
      if (Object.keys(ctx).length) entry.ctx = ctx;
    }
    entries.push(entry);
  }
  if (entries.length === 0) return { ok: false, error: 'no usable entries' };
  return { ok: true, value: { device, entries } };
}

// ── Storage ──────────────────────────────────────────────────────────────────

function dayOf(iso: string): string { return iso.slice(0, 10); }
function fileFor(day: string, device: string): string { return path.join(LOGS_DIR, day, `${device}.jsonl`); }

/** Append a validated batch. Returns lines written. Also fans out to tail listeners. */
export function appendLogs(batch: LogBatch, now = new Date()): number {
  const rx = now.toISOString();
  const byDay = new Map<string, string[]>();
  const out: StoredLine[] = [];
  for (const e of batch.entries) {
    const line: StoredLine = { ...e, device: batch.device.id, rx };
    if (batch.device.employeeId) line.emp = batch.device.employeeId;
    if (batch.device.app) line.app = batch.device.app;
    if (batch.device.qaMode) line.qa = true;
    // File by RECEIVE day so a device with a wrong clock can't scatter files.
    const day = dayOf(rx);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(JSON.stringify(line));
    out.push(line);
  }
  for (const [day, lines] of byDay) {
    const f = fileFor(day, batch.device.id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, lines.join('\n') + '\n');
  }
  rememberDevice(batch.device, rx);
  for (const line of out) logEvents.emit('line', line);
  return out.length;
}

// Device directory — last-seen meta so the portal can list devices without
// opening every file. Small JSON beside the day folders.
interface DeviceMeta extends DeviceInfo { lastSeen: string; lines?: number }
const DEVICES_FILE = path.join(LOGS_DIR, 'devices.json');
let deviceCache: Record<string, DeviceMeta> | null = null;
function loadDevices(): Record<string, DeviceMeta> {
  if (deviceCache) return deviceCache;
  try { deviceCache = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')) as Record<string, DeviceMeta>; }
  catch { deviceCache = {}; }
  return deviceCache;
}
function rememberDevice(d: DeviceInfo, seen: string): void {
  const all = loadDevices();
  all[d.id] = { ...(all[d.id] ?? { id: d.id, lastSeen: seen }), ...d, lastSeen: seen };
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(all, null, 2));
  } catch { /* best effort */ }
}
export function listLogDevices(): DeviceMeta[] {
  return Object.values(loadDevices()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// ── Query ────────────────────────────────────────────────────────────────────

export interface LogQuery {
  device?: string;              // device id, or 'server'
  since?:  string;              // ISO; default = start of yesterday
  until?:  string;
  level?:  LogLevel;            // minimum level
  module?: string;
  q?:      string;              // case-insensitive substring on msg + ctx
  limit?:  number;              // default 500, max 5000
}

function daysBetween(since: Date, until: Date): string[] {
  const days: string[] = [];
  const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  while (d <= until) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return days;
}

export function queryLogs(qry: LogQuery): StoredLine[] {
  const until = qry.until ? new Date(qry.until) : new Date();
  const since = qry.since ? new Date(qry.since) : new Date(until.getTime() - 36 * 3600 * 1000);
  const limit = Math.min(Math.max(1, qry.limit ?? 500), 5000);
  const minIdx = qry.level ? LOG_LEVELS.indexOf(qry.level) : 0;
  const needle = qry.q?.toLowerCase();
  const out: StoredLine[] = [];
  for (const day of daysBetween(since, until).reverse()) {
    const dir = path.join(LOGS_DIR, day);
    if (!fs.existsSync(dir)) continue;
    const files = qry.device ? [`${qry.device}.jsonl`] : fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    const dayLines: StoredLine[] = [];
    for (const f of files) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!raw) continue;
        let line: StoredLine;
        try { line = JSON.parse(raw) as StoredLine; } catch { continue; }
        const t = Date.parse(line.rx ?? line.ts);
        if (t < since.getTime() || t > until.getTime()) continue;
        if (LOG_LEVELS.indexOf(line.level) < minIdx) continue;
        if (qry.module && line.module !== qry.module) continue;
        if (needle) {
          const hay = (line.msg + ' ' + JSON.stringify(line.ctx ?? {})).toLowerCase();
          if (!hay.includes(needle)) continue;
        }
        dayLines.push(line);
      }
    }
    dayLines.sort((a, b) => a.ts.localeCompare(b.ts));
    out.unshift(...dayLines);
    if (out.length >= limit) break;
  }
  // newest-last, trimmed from the front so the tail of the window survives
  return out.length > limit ? out.slice(out.length - limit) : out;
}

export function formatLine(l: StoredLine): string {
  const ctx = l.ctx ? ' ' + Object.entries(l.ctx).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  return `${l.ts} ${l.level.toUpperCase().padEnd(5)} [${l.device}${l.emp ? '/' + l.emp : ''}] ${l.module}: ${l.msg}${ctx}`;
}

// ── Retention ────────────────────────────────────────────────────────────────

export function pruneLogs(retentionDays = Number(process.env.LOG_RETENTION_DAYS ?? 14), now = new Date()): number {
  if (!fs.existsSync(LOGS_DIR)) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 86400_000).toISOString().slice(0, 10);
  let removed = 0;
  for (const name of fs.readdirSync(LOGS_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    if (name < cutoff) { fs.rmSync(path.join(LOGS_DIR, name), { recursive: true, force: true }); removed++; }
  }
  return removed;
}

// ── Server console capture ───────────────────────────────────────────────────
// Mirror this process's console into logs/<day>/server.jsonl so device and
// server lines share one timeline. Guarded against re-entry; never throws.

let consoleHooked = false;
export function captureServerConsole(): void {
  if (consoleHooked) return;
  consoleHooked = true;
  const orig = { log: console.log, warn: console.warn, error: console.error };
  let inside = false;
  const write = (level: LogLevel, args: unknown[]) => {
    if (inside) return;
    inside = true;
    try {
      const msg = args.map(a => typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)).join(' ');
      const m = /^\[([A-Za-z0-9 _-]+)\]/.exec(msg);
      appendLogs({ device: { id: 'server' }, entries: [{ ts: new Date().toISOString(), level, module: m ? m[1].toLowerCase().replace(/\s+/g, '-') : 'server', msg }] });
    } catch { /* never let logging break the server */ }
    finally { inside = false; }
  };
  console.log   = (...a: unknown[]) => { orig.log(...a);   write('info',  a); };
  console.warn  = (...a: unknown[]) => { orig.warn(...a);  write('warn',  a); };
  console.error = (...a: unknown[]) => { orig.error(...a); write('error', a); };
}

/** Test hook. */
export function _logsDir(): string { return LOGS_DIR; }
