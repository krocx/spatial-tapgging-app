/**
 * Device routes - wearables and what they can deliver.
 *
 * GET /devices                → the profiles in docs/devices/*.md (no auth beyond the content gate)
 * GET /guides/:id/readiness   → lives in guides.ts; joins a guide's steps with these profiles
 *                               (docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from '../catalog/catalog-core.js';
import { profileFrom, type DeviceProfile } from '../guides/readiness.js';
import { canViewRestricted } from '../middleware/auth.js';
import { DATA_DIR } from '../data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function devicesDir(): string | null {
  const candidates = [path.join(__dirname, '../../../docs/devices'), path.join(process.cwd(), 'docs/devices'), path.join(process.cwd(), '../docs/devices')];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

/** Every valid profile, in file order; a malformed file is skipped with a console line, never a 500. */
export function readDeviceProfiles(): DeviceProfile[] {
  const dir = devicesDir(); if (!dir) return [];
  const out: DeviceProfile[] = [];
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'fit.md').sort()) {
    const parsed = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
    const p = parsed ? profileFrom(parsed.fm) : null;
    if (p) out.push(p); else console.warn(`[SIB] docs/devices/${name}: not a valid device profile - skipped`);
  }
  return out;
}

// ── Fit for the cleanroom (docs/devices/fit.md) ─────────────────────────────
// The category matrix, the requirements scorecard and the strategic read, as
// one JSON for /devices/fit. The whole page opens only with the IP key: the
// reads are our strategy, not the news.
const rows = (v: string | string[] | undefined): string[][] => (typeof v === 'string' ? v.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(c => c.trim())) : []);
const lines = (v: string | string[] | undefined): string[] => (typeof v === 'string' ? v.split('\n').map(l => l.trim()).filter(Boolean) : []);
export interface Fit {
  asOf: string; signal: string; means: string[]; bottom: string; sources: string;
  categories: { id: string; eye: string; kind: string; examples: string; role: string; lane: string }[];
  capabilities: { name: string; cells: string[] }[];
  devices: { id: string; name: string; segment: string; fit: string; verdict: string }[];
  requirements: { name: string; cells: { verdict: string; reason: string }[] }[];
  reads: { id: string; device: string; designedFor: string; read: string }[];
}
export function readFit(): Fit | null {
  const dir = devicesDir(); if (!dir) return null;
  const f = path.join(dir, 'fit.md'); if (!fs.existsSync(f)) return null;
  const parsed = parseFrontmatter(fs.readFileSync(f, 'utf8')); if (!parsed) return null;
  const fm = parsed.fm, s = (k: string) => (typeof fm[k] === 'string' ? (fm[k] as string).trim() : '');
  return {
    asOf: s('asOf'), signal: s('signal'), means: lines(fm.means), bottom: s('bottom'), sources: s('sources'),
    categories: rows(fm.categories).map(([id, eye, kind, examples, role, lane]) => ({ id, eye, kind, examples, role, lane })),
    capabilities: rows(fm.capabilities).map(([name, ...cells]) => ({ name, cells })),
    devices: rows(fm.devices).map(([id, name, segment, fit, verdict]) => ({ id, name, segment, fit, verdict })),
    requirements: rows(fm.requirements).map(([name, ...cells]) => ({ name, cells: cells.map(c => { const m = c.match(/^(YES|PART|NO)\s*:?\s*(.*)$/); return m ? { verdict: m[1], reason: m[2] } : { verdict: c, reason: '' }; }) })),
    reads: rows(fm.reads).map(([id, device, designedFor, read]) => ({ id, device, designedFor, read })),
  };
}

// ── AR glasses landscape (docs/devices/landscape/*.md + public feeds) ───────
export interface LandscapeEntry { id: string; date: string; maker: string; title: string; class: string; signal: string; summary: string; source: string; url: string; means?: string }
export function readLandscape(withMeans: boolean): LandscapeEntry[] {
  const dir = devicesDir(); if (!dir) return [];
  const ld = path.join(dir, 'landscape'); if (!fs.existsSync(ld)) return [];
  const out: LandscapeEntry[] = [];
  for (const name of fs.readdirSync(ld).filter(f => f.endsWith('.md') && !['README.md', 'sources.md'].includes(f))) {
    const parsed = parseFrontmatter(fs.readFileSync(path.join(ld, name), 'utf8')); if (!parsed) continue;
    const fm = parsed.fm, s = (k: string) => (typeof fm[k] === 'string' ? (fm[k] as string).trim() : '');
    if (!s('date') || !s('title')) continue;
    out.push({ id: s('id') || name.replace(/\.md$/, ''), date: s('date'), maker: s('maker'), title: s('title'), class: s('class'), signal: s('signal'), summary: s('summary'), source: s('source'), url: s('url'), ...(withMeans && s('means') ? { means: s('means') } : {}) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
interface WireItem { title: string; url: string; date: string; source: string }
interface Wire { items: WireItem[]; refreshedAt: string | null; sources: string[]; error?: string }
let wire: Wire = { items: [], refreshedAt: null, sources: [] };
let wireBusy = false;
const WIRE_TTL = 60 * 60 * 1000;
function wireConfig(): { feeds: { name: string; url: string }[]; keep: string[] } {
  const dir = devicesDir(); const f = dir ? path.join(dir, 'landscape', 'sources.md') : '';
  if (!f || !fs.existsSync(f)) return { feeds: [], keep: [] };
  const parsed = parseFrontmatter(fs.readFileSync(f, 'utf8')); if (!parsed) return { feeds: [], keep: [] };
  return { feeds: rows(parsed.fm.feeds).map(([name, url]) => ({ name, url })).filter(x => x.url), keep: String(parsed.fm.keep || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean) };
}
const unesc = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
async function refreshWire(): Promise<void> {
  if (wireBusy) return; wireBusy = true;
  const cfg = wireConfig(); const items: WireItem[] = []; const okSources: string[] = []; let error = '';
  for (const feed of cfg.feeds) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(feed.url, { signal: ctl.signal, headers: { 'User-Agent': 'SIB landscape (appliedx)' } }); clearTimeout(timer);
      if (!r.ok) { error += `${feed.name}: HTTP ${r.status}. `; continue; }
      const xml = await r.text();
      const found = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
      if (!found.length) continue; // not an RSS feed (a newsroom HTML page, say) - skipped quietly
      okSources.push(feed.name);
      for (const it of found) {
        const title = unesc((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''), url = unesc((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ''), date = unesc((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
        const hay = title.toLowerCase();
        if (title && url && cfg.keep.some(k => hay.includes(k))) items.push({ title, url, date: date ? new Date(date).toISOString() : '', source: feed.name });
      }
    } catch (e) { error += `${feed.name}: ${(e as Error).message}. `; }
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  wire = { items: items.slice(0, 30), refreshedAt: new Date().toISOString(), sources: okSources, ...(error ? { error: error.trim() } : {}) };
  wireBusy = false;
}
function wireFresh(): Wire { // serve what we have; refresh in the background when stale
  if (!wire.refreshedAt || Date.now() - Date.parse(wire.refreshedAt) > WIRE_TTL) void refreshWire().catch(() => { wireBusy = false; });
  return wire;
}

// ── Exports: Word documents with the two logos, the generated date and the footnote ──
const FOOT = 'Applied Materials Strictly Confidential';
function logoBytes(file: string): Buffer | null {
  for (const p of [path.join(DATA_DIR, 'platform', 'media', file), path.join(__dirname, '../../portal/platform-media', file)]) { if (fs.existsSync(p)) return fs.readFileSync(p); }
  return null;
}
type DocxMod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function docxMod(): Promise<DocxMod | null> { try { const name = 'docx'; return (await import(name)) as DocxMod; } catch { return null; } }
async function buildDoc(D: DocxMod, title: string, subtitle: string, blocks: unknown[]): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType, PageNumber, TabStopType, TabStopPosition } = D;
  const generated = new Date();
  const logos: unknown[] = [];
  for (const [file, h] of [['logo-amat.png', 28], ['logo-appliedx.png', 32]] as const) { const b = logoBytes(file); if (b) logos.push(new ImageRun({ type: 'png', data: b, transformation: { width: Math.round(h * 3.2), height: h }, altText: { title: file, description: file, name: file } }), new TextRun('    ')); }
  const header = new Header({ children: [new Paragraph({ children: logos.length ? logos : [new TextRun({ text: 'Applied Materials · appliedx', bold: true })] })] });
  const footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], children: [new TextRun({ text: `${FOOT} · generated ${generated.toISOString().slice(0, 10)}`, size: 16 }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT], size: 16 })] })] });
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } }, paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } }, headers: { default: header }, footers: { default: footer },
      children: [new Paragraph({ heading: 'Heading1', children: [new TextRun(title)] }), new Paragraph({ children: [new TextRun({ text: subtitle, color: '666666' })], spacing: { after: 200 } }), ...(blocks as any[]), // eslint-disable-line @typescript-eslint/no-explicit-any
        new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: `Report generated ${generated.toUTCString()}. ${FOOT}.`, size: 16, color: '666666' })] })] }],
  });
  return Packer.toBuffer(doc);
}
function para(D: DocxMod, text: string, opts: Record<string, unknown> = {}): unknown { return new D.Paragraph({ children: [new D.TextRun({ text, ...opts })], spacing: { after: 120 } }); }
function h2(D: DocxMod, text: string): unknown { return new D.Paragraph({ heading: 'Heading2', children: [new D.TextRun(text)] }); }
function table(D: DocxMod, head: string[], body: string[][], widths: number[]): unknown {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType } = D;
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' }, borders = { top: border, bottom: border, left: border, right: border };
  const cell = (t: string, w: number, bold = false, fill?: string) => new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 90, right: 90 }, ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}), children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 17 })] })] });
  const fillFor = (t: string) => /^YES/.test(t) ? 'DDF5E3' : /^PART/.test(t) ? 'FFF1D6' : /^NO/.test(t) ? 'FADBD8' : undefined;
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, widths[i], true, 'EEEEEE')) }), ...body.map(r => new TableRow({ children: r.map((t, i) => cell(t, widths[i], false, i ? fillFor(t) : undefined)) }))] });
}

const router = Router();
router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data: readDeviceProfiles(), timestamp: new Date().toISOString() });
});
router.get('/fit.json', (req: Request, res: Response) => {
  if (!canViewRestricted(req)) { res.status(403).json({ error: 'restricted', hint: 'This page needs the IP key' }); return; }
  const fit = readFit(); if (!fit) { res.status(404).json({ error: 'docs/devices/fit.md not on this deployment' }); return; }
  res.setHeader('Cache-Control', 'no-cache'); res.json({ data: fit, timestamp: new Date().toISOString() });
});
router.get('/landscape.json', (req: Request, res: Response) => {
  const restricted = canViewRestricted(req);
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data: { entries: readLandscape(restricted), wire: wireFresh(), restricted }, timestamp: new Date().toISOString() });
});
router.post('/landscape/refresh', async (_req: Request, res: Response) => { await refreshWire().catch(() => { wireBusy = false; }); res.json({ data: wire, timestamp: new Date().toISOString() }); });
router.get('/fit/export.docx', async (req: Request, res: Response) => {
  if (!canViewRestricted(req)) { res.status(403).json({ error: 'restricted' }); return; }
  const fit = readFit(); if (!fit) { res.status(404).json({ error: 'not available' }); return; }
  const D = await docxMod(); if (!D) { res.status(503).json({ error: 'Word export needs the docx package on this server (npm install)' }); return; }
  const blocks: unknown[] = [h2(D, 'The market signal'), para(D, fit.signal),
    h2(D, 'By category: what each device category can and cannot do for AR work instructions'),
    table(D, ['Capability', ...fit.categories.map(c => `${c.eye} · ${c.kind}`)], fit.capabilities.map(c => [c.name, ...c.cells]), [2000, ...fit.categories.map(() => Math.floor(7800 / fit.categories.length))]),
    para(D, 'Role in AR OMS: ' + fit.categories.map(c => `${c.eye} ${c.kind} - ${c.role}`).join('; ') + '.', { size: 17 }),
    h2(D, 'By requirement: devices against our enterprise cleanroom requirements'),
    table(D, ['Requirement', ...fit.devices.map(d => d.name)], [...fit.requirements.map(r => [r.name, ...r.cells.map(c => c.reason ? `${c.verdict}: ${c.reason}` : c.verdict)]), ['Fit for AR OMS today', ...fit.devices.map(d => d.verdict)]], [2200, ...fit.devices.map(() => Math.floor(7600 / fit.devices.length))]),
    para(D, 'YES = meets the requirement today · PART = partially, with caveats · NO = does not meet. The assessment reflects our POC criteria, not vendor marketing.', { size: 17, color: '666666' }),
    h2(D, 'The strategic read'), ...fit.reads.flatMap(r => [para(D, r.device, { bold: true }), para(D, `Designed for: ${r.designedFor}`), para(D, r.read)]),
    h2(D, 'What this means'), ...fit.means.map(m => para(D, m)), para(D, fit.bottom, { bold: true, italics: true }), para(D, `Market status as of ${fit.asOf}. Sources: ${fit.sources}`, { size: 16, color: '666666' })];
  const buf = await buildDoc(D, 'Fit for the cleanroom', 'AR glasses and headsets against AR OMS and our enterprise cleanroom requirements · Connected Worker AR OMS Platform', blocks);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.setHeader('Content-Disposition', `attachment; filename="Fit-for-the-cleanroom-${new Date().toISOString().slice(0, 10)}.docx"`); res.send(buf);
});
router.get('/landscape/export.docx', async (req: Request, res: Response) => {
  const restricted = canViewRestricted(req); const id = typeof req.query.id === 'string' ? req.query.id : '';
  const all = readLandscape(restricted); const list = id ? all.filter(e => e.id === id) : all;
  if (!list.length) { res.status(404).json({ error: 'no such entry' }); return; }
  const D = await docxMod(); if (!D) { res.status(503).json({ error: 'Word export needs the docx package on this server (npm install)' }); return; }
  const blocks: unknown[] = list.flatMap(e => [h2(D, e.title), para(D, `${e.date} · ${e.maker} · ${e.class} · ${e.signal}`, { color: '666666', size: 17 }), para(D, e.summary), ...(e.means ? [para(D, 'What it means for us: ' + e.means, { italics: true })] : []), para(D, `Source: ${e.source} - ${e.url}`, { size: 16, color: '666666' })]);
  const buf = await buildDoc(D, id ? list[0].title : 'AR glasses landscape', id ? 'AR glasses landscape · Connected Worker AR OMS Platform' : 'Announcements and what they mean for us · Connected Worker AR OMS Platform', blocks);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.setHeader('Content-Disposition', `attachment; filename="AR-glasses-landscape${id ? '-' + id : ''}-${new Date().toISOString().slice(0, 10)}.docx"`); res.send(buf);
});
export default router;
