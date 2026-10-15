#!/usr/bin/env node
// backlog-jira.mjs - the Jira CSV for the AROMS backlog (docs/BACKLOG.md).
//
//   npm run backlog:jira                   full export: capability register (AROMS-100…, from
//                                          docs/catalog) + work items (AROMS-300…, from docs/BACKLOG.md)
//   npm run backlog:jira -- --since DATE   only rows updated on or after DATE (the Friday delta)
//
// Keys are stable: docs/jira/keys.json maps a catalogue id to its number and
// only ever grows. The CSV carries an Issue Key column so Jira updates the
// same issue each time ("update existing issues" on import).
//
// Proprietary & Confidential · Applied Materials.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = path.join(ROOT, 'docs/catalog');
const BACKLOG = path.join(ROOT, 'docs/BACKLOG.md');
const KEYS = path.join(ROOT, 'docs/jira/keys.json');
const OUT_DIR = path.join(ROOT, 'docs/jira');
const PROJECT = 'AROMS';
const CAP_FIRST = 100, WORK_FIRST = 300;

const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;

// ── Capability register from the catalogue ──────────────────────────────────
const fm = (s) => { const m = s.match(/^---\n([\s\S]*?)\n---/); if (!m) return null; const o = {}; for (const line of m[1].split('\n')) { const k = line.match(/^([a-z]+):\s*(.*)$/i); if (k) o[k[1]] = k[2].trim(); } return o; };
const keys = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : { next: CAP_FIRST, byId: {} };
const caps = [];
for (const f of fs.readdirSync(CATALOG).filter(f => f.endsWith('.md') && f !== 'README.md').sort()) {
  const o = fm(fs.readFileSync(path.join(CATALOG, f), 'utf8'));
  if (!o?.id || !o.name || o.kind === 'area') continue;   // area pages are not capabilities
  if (!keys.byId[o.id]) { keys.byId[o.id] = keys.next++; }
  if (keys.next >= WORK_FIRST) throw new Error('capability keys would cross into the work band - raise WORK_FIRST');
  const status = o.status === 'shipped' ? 'Done' : o.status === 'beta' ? 'In Progress' : 'To Do';
  caps.push({ key: `${PROJECT}-${keys.byId[o.id]}`, type: 'Story', summary: o.name, description: `Catalogue feature \`${o.id}\` (docs/catalog/${f}); live at /catalog#${o.id}.`,
    status, component: o.area || '', labels: ['capability', o.area || ''].filter(Boolean).join(' '), version: o.version && o.version !== 'baseline' ? o.version : '', updated: '' });
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(KEYS, JSON.stringify(keys, null, 2) + '\n');

// ── Work items from docs/BACKLOG.md ────────────────────────────────────────
const md = fs.readFileSync(BACKLOG, 'utf8');
const work = [];
for (const line of md.split('\n')) {
  const m = line.match(/^\|\s*(AROMS-\d+)\s*\|(.*)\|\s*$/);
  if (!m) continue;
  const cells = m[2].split('|').map(c => c.trim());
  if (cells.length < 7) continue;
  const [item, component, owner, status, version, updated, notes] = cells;
  const jira = { done: 'Done', doing: 'In Progress', todo: 'To Do', parked: 'To Do', wont: 'Done' }[status] ?? 'To Do';
  work.push({ key: m[1], type: 'Task', summary: item, description: [notes, owner ? `Owner: ${owner}` : '', status === 'parked' ? 'Parked.' : status === 'wont' ? "Won't do." : ''].filter(Boolean).join(' · '),
    status: jira, component, labels: ['work', status, ...component.split(',').map(s => s.trim()).filter(Boolean)].join(' '), version, updated });
}

// ── Output ─────────────────────────────────────────────────────────────────
let rows = [...caps, ...work];
if (since) rows = rows.filter(r => r.updated && r.updated >= since);
const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['Issue Key', 'Issue Type', 'Summary', 'Description', 'Status', 'Component', 'Labels', 'Fix Version'];
const csv = [header.join(','), ...rows.map(r => [r.key, r.type, r.summary, r.description, r.status, r.component, r.labels, r.version].map(esc).join(','))].join('\n') + '\n';
const stamp = new Date().toISOString().slice(0, 10);
const out = path.join(OUT_DIR, `${PROJECT}-${since ? `delta-${since}-to-` : ''}${stamp}.csv`);
fs.writeFileSync(out, csv);
console.log(`${path.relative(ROOT, out)}: ${rows.length} row(s)` + (since ? ` updated since ${since}` : ` (${caps.length} capabilities, ${work.length} work items)`));
