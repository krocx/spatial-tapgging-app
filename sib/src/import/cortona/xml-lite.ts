// xml-lite.ts — tiny dependency-free XML reader for the Cortona3D side files.
// Builds a plain element tree; namespaces are stripped to local names; CDATA,
// comments, PIs and the five predefined + numeric entities are handled.
// Not a validating parser and not for untrusted input at scale — the inputs
// here are ≤ a few MB of tool-generated XML.

export interface XmlEl {
  name:     string;                    // local name (prefix stripped)
  attrs:    Record<string, string>;    // attribute names also prefix-stripped
  children: XmlEl[];
  text:     string;                    // concatenated direct text + CDATA
  parent?:  XmlEl;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

const local = (n: string): string => { const i = n.indexOf(':'); return i >= 0 ? n.slice(i + 1) : n; };

export function parseXml(src: string): XmlEl {
  const root: XmlEl = { name: '#document', attrs: {}, children: [], text: '' };
  let cur = root;
  let i = 0; const n = src.length;
  if (src.charCodeAt(0) === 0xFEFF) i = 1;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { cur.text += decodeEntities(src.slice(i)); break; }
    if (lt > i) cur.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); cur.text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', lt)) { // DOCTYPE etc. — skip to matching '>' (no internal subset support)
      let depth = 0; let j = lt;
      for (; j < n; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; else if (src[j] === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    const gt = findTagEnd(src, lt);
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') { if (cur.parent) cur = cur.parent; continue; }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const sp = body.search(/[\s]/);
    const name = local(sp < 0 ? body : body.slice(0, sp));
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let m: RegExpExecArray | null;
      const rest = body.slice(sp);
      while ((m = re.exec(rest))) attrs[local(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const el: XmlEl = { name, attrs, children: [], text: '', parent: cur };
    cur.children.push(el);
    if (!selfClose) cur = el;
  }
  return root;
}

function findTagEnd(src: string, lt: number): number {
  let q: string | null = null;
  for (let j = lt + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return j;
  }
  return src.length - 1;
}

/** Depth-first walk. */
export function walkXml(el: XmlEl, fn: (e: XmlEl) => void): void {
  for (const c of el.children) { fn(c); walkXml(c, fn); }
}
export function findAll(el: XmlEl, name: string): XmlEl[] {
  const out: XmlEl[] = []; walkXml(el, e => { if (e.name === name) out.push(e); }); return out;
}
export function child(el: XmlEl, name: string): XmlEl | undefined {
  return el.children.find(c => c.name === name);
}
export function childText(el: XmlEl, name: string): string {
  return child(el, name)?.text.trim() ?? '';
}
