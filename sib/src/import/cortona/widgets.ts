// widgets.ts — annotation widgets (callouts / panels) and their body text.
//
// In the published scene, callouts are PROTO instances (PanelImg*, PanelHtml*,
// CalloutM*, VMTighten*, VMRope*, Set_Arrow*) that SubStep commands reveal
// and hide exactly like parts (SwitchOFF / Set_transparency routed to the
// widget's DEF). Their body copy is RTF or HTML in `string` / `htmlbody` /
// `richtext` fields (or `url` data: URIs for image panels). We reduce each
// widget to plain text so the step that reveals it can carry the words;
// positions are kept for a future node-bound tag import.

import { type VrmlScene, type VrmlNode, numField, walkNodes } from './vrml.js';

export interface WidgetInfo {
  def:      string;
  type:     string;
  text?:    string;                       // plain text (RTF/HTML stripped)
  hasImage: boolean;
  position?: [number, number, number];    // translation in its parent frame
  parentDef?: string;                     // nearest DEF'd ancestor (usually the part)
}

const WIDGET_RE = /^(PanelImg\d*|PanelHtml\d*|CalloutM\d*|VMTighten\d*|VMRope\d*|Set_Arrow\d*|HTMLText|Panel)$/;

export function collectWidgets(scene: VrmlScene): Map<string, WidgetInfo> {
  const out = new Map<string, WidgetInfo>();
  const parentDef = new Map<VrmlNode, string | undefined>();
  walkNodes(scene.nodes, (n, parent) => {
    const inherited = parent ? (parent.def ?? parentDef.get(parent)) : undefined;
    parentDef.set(n, inherited);
    if (!n.def || !WIDGET_RE.test(n.type)) return;
    const w: WidgetInfo = { def: n.def, type: n.type, hasImage: false, parentDef: inherited };
    const t = numField(n, 'translation', []); if (t.length === 3) w.position = [t[0], t[1], t[2]];
    const texts: string[] = [];
    for (const key of ['string', 'htmlbody', 'richtext', 'text', 'title', 'label']) {
      const v = n.fields[key];
      if (typeof v === 'string') texts.push(v);
      else if (Array.isArray(v) && typeof v[0] === 'string') texts.push(...(v as string[]));
    }
    const url = n.fields['url'];
    const urls = typeof url === 'string' ? [url] : Array.isArray(url) && typeof url[0] === 'string' ? (url as string[]) : [];
    if (urls.some(u => /^data:image\//i.test(u) || /\.(png|jpe?g|svg)$/i.test(u))) w.hasImage = true;
    const plain = texts.map(toPlainText).map(s => s.trim()).filter(Boolean).join('\n');
    if (plain) w.text = plain;
    out.set(n.def, w);
  });
  return out;
}

/** RTF or HTML → plain text; plain input passes through. */
export function toPlainText(s: string): string {
  const t = s.trim();
  if (t.startsWith('{\\rtf')) return rtfToText(t);
  if (/<[a-z!/][^>]*>/i.test(t)) return htmlToText(t);
  return t;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|p|div|li|tr|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Minimal RTF reader: drops control words, keeps text, honours \par, \line, \'hh, \u. Skips font/colour tables. */
export function rtfToText(rtf: string): string {
  let out = ''; let i = 0; const n = rtf.length;
  let depth = 0; const skipDepth: number[] = [];   // group depths being skipped (fonttbl, colortbl, …)
  const isSkipping = () => skipDepth.length > 0;
  while (i < n) {
    const c = rtf[i];
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { if (skipDepth.length && skipDepth[skipDepth.length - 1] === depth) skipDepth.pop(); depth--; i++; continue; }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 32));
      if (m) {
        const word = m[1]; const param = m[2];
        i += m[0].length;
        if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'generator'].includes(word)) skipDepth.push(depth);
        else if (!isSkipping()) {
          if (word === 'par' || word === 'line') out += '\n';
          else if (word === 'tab') out += '\t';
          else if (word === 'u' && param) { out += String.fromCharCode(((Number(param) % 65536) + 65536) % 65536); if (rtf[i] === '?') i++; }
        }
        continue;
      }
      if (rtf[i + 1] === "'") { const hex = rtf.slice(i + 2, i + 4); if (!isSkipping()) out += String.fromCharCode(parseInt(hex, 16) || 63); i += 4; continue; }
      if (rtf[i + 1] === '*') { skipDepth.push(depth); i += 2; continue; }
      if (!isSkipping()) out += rtf[i + 1] ?? ''; i += 2; continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (!isSkipping()) out += c; i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
