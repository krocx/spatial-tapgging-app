/**
 * Ask SIB - the documents beyond the catalogue.
 *
 * The explain pages, the positioning principles, the device profiles, the
 * fit page and the landscape entries, as one corpus the retrieval tier can
 * rank next to the catalogue features. Each document knows whether it is
 * restricted (IP key) so it never enters an answer for a caller who could not
 * open the page. Rebuilt every five minutes at most; HTML is reduced to text.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tokenize } from './ask-core.js';
import { readDeviceProfiles, readFit, readLandscape } from '../routes/devices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AskDoc { id: string; kind: 'explain' | 'doc' | 'device' | 'fit' | 'landscape'; title: string; href: string; text: string; restricted: boolean }
export interface DocHit { id: string; kind: AskDoc['kind']; title: string; href: string; score: number; excerpt: string; restricted: boolean }

function docsDir(): string | null {
  const c = [path.join(__dirname, '../../../docs'), path.join(process.cwd(), 'docs'), path.join(process.cwd(), '../docs')];
  return c.find(p => fs.existsSync(p)) ?? null;
}
const strip = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const titleOf = (html: string, fallback: string): string => { const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i); return m ? strip(m[1]).replace(/\s*·.*$/, '') : fallback; };

let cache: { at: number; docs: AskDoc[] } | null = null;
export function askDocs(): AskDoc[] {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.docs;
  const out: AskDoc[] = []; const dir = docsDir();
  if (dir) {
    const ex = path.join(dir, 'explain');
    if (fs.existsSync(ex)) for (const f of fs.readdirSync(ex).filter(f => f.endsWith('.html') && !['locked.html', 'index.html'].includes(f))) {
      const html = fs.readFileSync(path.join(ex, f), 'utf8'); const id = f.replace(/\.html$/, '');
      out.push({ id: 'explain:' + id, kind: 'explain', title: titleOf(html, id), href: '/explain/' + id, text: strip(html), restricted: id === 'spatial-intelligence' });
    }
    const containers = path.join(dir, 'CONTAINERS.html');
    if (fs.existsSync(containers)) { const html = fs.readFileSync(containers, 'utf8'); out.push({ id: 'explain:containers', kind: 'explain', title: titleOf(html, 'The three containers'), href: '/containers', text: strip(html), restricted: true }); }
    const pos = path.join(dir, 'POSITIONING.md');
    if (fs.existsSync(pos)) out.push({ id: 'doc:positioning', kind: 'doc', title: 'Positioning: how SIB is described', href: '/explain', text: fs.readFileSync(pos, 'utf8').replace(/[#*`|]/g, ' ').replace(/\s+/g, ' '), restricted: true });
  }
  for (const p of readDeviceProfiles()) {
    const i = p.info || {};
    out.push({ id: 'device:' + p.id, kind: 'device', title: p.name, href: '/devices/gallery#' + p.id, restricted: false,
      text: [i.what, `display ${p.display}, overlay ${p.overlay}, delivery ${p.delivery}, input ${p.input.join(' ')}`, i.displaySpec, i.fov, i.weight, i.battery, i.cleanroom, i.poc, p.notes].filter(Boolean).join('. ') });
  }
  const fit = readFit();
  if (fit) {
    out.push({ id: 'fit:signal', kind: 'fit', title: 'Fit for the cleanroom: the market signal', href: '/devices/fit', text: [fit.signal, ...fit.means, fit.bottom].join(' '), restricted: true });
    for (const r of fit.reads) out.push({ id: 'fit:' + r.id, kind: 'fit', title: `Fit for the cleanroom: ${r.device}`, href: '/devices/fit', text: `${r.designedFor} ${r.read}`, restricted: true });
  }
  for (const e of readLandscape(true)) out.push({ id: 'landscape:' + e.id, kind: 'landscape', title: `${e.maker}: ${e.title}`, href: '/devices/landscape#' + e.id, text: `${e.date} ${e.summary}`, restricted: false });
  for (const e of readLandscape(true)) if (e.means) out.push({ id: 'landscape-means:' + e.id, kind: 'landscape', title: `What ${e.maker}'s announcement means for us`, href: '/devices/landscape#' + e.id, text: e.means, restricted: true });
  cache = { at: Date.now(), docs: out };
  return out;
}

function hits(text: string, token: string): number { let n = 0, i = 0; while ((i = text.indexOf(token, i)) !== -1) { n++; i += token.length; } return n; }
export function retrieveDocs(question: string, ip: boolean, topN = 4): DocHit[] {
  const tokens = tokenize(question); if (!tokens.length) return [];
  return askDocs().filter(d => ip || !d.restricted).map(d => {
    const title = d.title.toLowerCase(), body = d.text.toLowerCase(); let score = 0, first = -1;
    for (const t of tokens) { score += 4 * hits(title, t) + Math.min(3, hits(body, t)); if (first < 0) first = body.indexOf(t); }
    const start = Math.max(0, first - 90), excerpt = (start > 0 ? '…' : '') + d.text.slice(start, start + 260).trim() + (d.text.length > start + 260 ? '…' : '');
    if (d.kind === 'explain') score *= 1.6; // the pages written to explain outrank a device card that merely mentions the word
    return { id: d.id, kind: d.kind, title: d.title, href: d.href, score, excerpt, restricted: d.restricted };
  }).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, topN);
}
