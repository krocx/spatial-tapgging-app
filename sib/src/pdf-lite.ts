/**
 * pdf-lite - a small PDF writer for the reports SIB exports (Fit for the
 * cleanroom, the AR glasses landscape). No new dependency: the page is
 * written by hand (PDF 1.4, Helvetica, WinAnsi), the logos are decoded with
 * jimp (already a dependency) and embedded as RGB images with an alpha mask.
 *
 *   const pdf = new PdfLite({ title, subtitle, logos: [buffer, ...] });
 *   pdf.h2('...'); pdf.p('...'); pdf.table(head, rows, widths);
 *   const bytes = await pdf.build();
 *
 * Every page carries the logos and the title in the header, and
 * "Applied Materials Strictly Confidential · generated <date> · page n of m"
 * in the footer. US Letter, 54-pt margins.
 */
import zlib from 'zlib';
import Jimp from 'jimp';

// Helvetica character widths (AFM, per 1000 em) for the printable ASCII
// range, then a few WinAnsi extras we use (· – — ' ' " " ™ é).
const W: Record<string, number> = {};
const ASCII = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
for (let i = 32; i < 127; i++) W[String.fromCharCode(i)] = ASCII[i - 32];
Object.assign(W, { '·': 278, '–': 556, '—': 1000, '‘': 222, '’': 222, '“': 333, '”': 333, '™': 1000, 'é': 556, '°': 400, '…': 1000, '→': 584, '×': 584 });
const WINANSI: Record<string, number> = { '·': 0xB7, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '™': 0x99, 'é': 0xE9, '°': 0xB0, '…': 0x85, '×': 0xD7 };
function textWidth(s: string, size: number): number { let w = 0; for (const ch of s) w += (W[ch] ?? 556); return w * size / 1000; }
function encode(s: string): string { // WinAnsi bytes, escaped for a PDF string
  let out = '';
  for (const ch of s) {
    let code = ch.charCodeAt(0);
    if (code > 126) code = WINANSI[ch] ?? (ch === '→' ? 0x2D : 0x3F);
    const c = String.fromCharCode(code);
    out += c === '(' || c === ')' || c === '\\' ? '\\' + c : code < 32 ? ' ' : c;
  }
  return out;
}
function wrap(s: string, size: number, maxW: number): string[] {
  const words = s.split(/\s+/).filter(Boolean), lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (textWidth(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines.length ? lines : [''];
}

interface Img { w: number; h: number; rgb: Buffer; alpha: Buffer }
type Fill = [number, number, number];
const PAGE_W = 612, PAGE_H = 792, M = 54, HEADER_H = 48, FOOTER_H = 30;
const FILLS: Record<string, Fill> = { YES: [0.87, 0.96, 0.89], PART: [1, 0.95, 0.84], NO: [0.98, 0.86, 0.85], HEAD: [0.93, 0.93, 0.93], NAME: [0.96, 0.96, 0.96] };
const INK: Record<string, Fill> = { YES: [0.1, 0.5, 0.2], PART: [0.7, 0.42, 0], NO: [0.75, 0.15, 0.1] };

export class PdfLite {
  private ops: string[][] = [[]];
  private y = PAGE_H - M - HEADER_H;
  private imgs: Img[] = [];
  constructor(private opts: { title: string; subtitle?: string; logos?: Buffer[]; footer?: string }) {}

  private get cur(): string[] { return this.ops[this.ops.length - 1]; }
  private newPage(): void { this.ops.push([]); this.y = PAGE_H - M - HEADER_H; }
  private need(h: number): void { if (this.y - h < M + FOOTER_H) this.newPage(); }
  private text(x: number, y: number, s: string, size: number, bold = false, ink: Fill = [0.1, 0.1, 0.1]): void {
    this.cur.push(`BT /${bold ? 'FB' : 'F'} ${size} Tf ${ink.join(' ')} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${encode(s)}) Tj ET`);
  }
  private rect(x: number, y: number, w: number, h: number, fill?: Fill, stroke?: Fill): void {
    const f = fill ? `${fill.join(' ')} rg ` : '', s = stroke ? `${stroke.join(' ')} RG 0.5 w ` : '';
    this.cur.push(`${f}${s}${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }

  h1(s: string): void { this.need(30); this.y -= 22; this.text(M, this.y, s, 18, true); this.y -= 10; }
  h2(s: string): void { this.need(28); this.y -= 18; for (const l of wrap(s, 13, PAGE_W - 2 * M)) { this.text(M, this.y, l, 13, true); this.y -= 16; } this.y -= 2; }
  p(s: string, o: { size?: number; bold?: boolean; italic?: boolean; ink?: Fill; indent?: number } = {}): void {
    const size = o.size ?? 10, lh = size * 1.4, x = M + (o.indent ?? 0);
    for (const l of wrap(s, size, PAGE_W - 2 * M - (o.indent ?? 0))) { this.need(lh); this.y -= lh; this.text(x, this.y, l, size, !!o.bold, o.ink ?? (o.italic ? [0.35, 0.35, 0.35] : [0.1, 0.1, 0.1])); }
    this.y -= 4;
  }
  gap(h = 8): void { this.y -= h; }
  /** A table: widths are relative; the first column is the name column; a cell that starts with YES / PART / NO is tinted. */
  table(head: string[], rows: string[][], rel: number[], o: { size?: number } = {}): void {
    const size = o.size ?? 8, lh = size * 1.3, pad = 4, totalW = PAGE_W - 2 * M, sum = rel.reduce((a, b) => a + b, 0), widths = rel.map(r => r / sum * totalW);
    const layout = (cells: string[]) => cells.map((c, i) => wrap(c, size, widths[i] - 2 * pad));
    const drawRow = (cells: string[], isHead: boolean) => {
      const lines = layout(cells), h = Math.max(...lines.map(l => l.length)) * lh + 2 * pad;
      if (this.y - h < M + FOOTER_H) { this.newPage(); if (!isHead) drawRow(head, true); }
      let x = M; const top = this.y;
      cells.forEach((c, i) => {
        const key = isHead ? 'HEAD' : i === 0 ? 'NAME' : (c.match(/^(YES|PART|NO)\b/) || [])[1];
        this.rect(x, top - h, widths[i], h, key ? FILLS[key] : undefined, [0.75, 0.75, 0.75]);
        lines[i].forEach((l, k) => {
          const verdict = !isHead && i > 0 && k === 0 ? (l.match(/^(YES|PART|NO)\b/) || [])[1] : undefined;
          this.text(x + pad, top - pad - (k + 1) * lh + size * 0.3, l, size, isHead || !!verdict, verdict ? INK[verdict] : [0.12, 0.12, 0.12]);
        });
        x += widths[i];
      });
      this.y = top - h;
    };
    drawRow(head, true); for (const r of rows) drawRow(r, false); this.y -= 6;
  }

  private async decodeLogos(): Promise<void> {
    for (const buf of this.opts.logos ?? []) {
      try {
        const img = await Jimp.read(buf); const { width, height, data } = img.bitmap;
        const rgb = Buffer.alloc(width * height * 3), alpha = Buffer.alloc(width * height);
        for (let i = 0, j = 0, k = 0; i < data.length; i += 4, j += 3, k++) { rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]; alpha[k] = data[i + 3]; }
        this.imgs.push({ w: width, h: height, rgb: zlib.deflateSync(rgb), alpha: zlib.deflateSync(alpha) });
      } catch { /* a logo that cannot be decoded is left out; the header still says who we are */ }
    }
  }
  async build(): Promise<Buffer> {
    await this.decodeLogos();
    const generated = new Date(), foot = `${this.opts.footer ?? 'Applied Materials Strictly Confidential'} · generated ${generated.toISOString().slice(0, 10)}`;
    const objs: string[] = []; const add = (s: string): number => { objs.push(s); return objs.length; };
    // fonts, images
    const fontN = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgRefs: number[] = [];
    for (const im of this.imgs) {
      const sm = add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.alpha.length} >>\nstream\n` + im.alpha.toString('binary') + '\nendstream');
      imgRefs.push(add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${sm} 0 R /Filter /FlateDecode /Length ${im.rgb.length} >>\nstream\n` + im.rgb.toString('binary') + '\nendstream'));
    }
    const xobj = imgRefs.map((r, i) => `/Im${i} ${r} 0 R`).join(' ');
    const pagesIdx = add('PLACEHOLDER'); const pageIds: number[] = [];
    const n = this.ops.length;
    this.ops.forEach((body, pi) => {
      // header: logos left, title right; footer: confidential, page n of m
      const hdr: string[] = []; let x = M; const top = PAGE_H - M;
      this.imgs.forEach((im, i) => { const h = 24, w = im.w / im.h * h; hdr.push(`q ${w.toFixed(1)} 0 0 ${h} ${x.toFixed(1)} ${(top - h).toFixed(1)} cm /Im${i} Do Q`); x += w + 14; });
      if (!this.imgs.length) hdr.push(`BT /FB 10 Tf 0.1 0.1 0.1 rg ${M} ${top - 16} Td (${encode('Applied Materials · appliedx')}) Tj ET`);
      const t = this.opts.title; hdr.push(`BT /FB 9 Tf 0.35 0.35 0.35 rg ${(PAGE_W - M - textWidth(t, 9)).toFixed(1)} ${top - 16} Td (${encode(t)}) Tj ET`);
      hdr.push(`0.8 0.8 0.8 RG 0.5 w ${M} ${top - HEADER_H + 10} m ${PAGE_W - M} ${top - HEADER_H + 10} l S`);
      const pg = `page ${pi + 1} of ${n}`;
      hdr.push(`BT /F 7.5 Tf 0.4 0.4 0.4 rg ${M} ${M - 10} Td (${encode(foot)}) Tj ET`, `BT /F 7.5 Tf 0.4 0.4 0.4 rg ${(PAGE_W - M - textWidth(pg, 7.5)).toFixed(1)} ${M - 10} Td (${encode(pg)}) Tj ET`);
      const content = [...hdr, ...body].join('\n');
      const cId = add(`<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesIdx} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F ${fontN} 0 R /FB ${fontB} 0 R >> ${xobj ? `/XObject << ${xobj} >>` : ''} >> /Contents ${cId} 0 R >>`));
    });
    objs[pagesIdx - 1] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const catalog = add(`<< /Type /Catalog /Pages ${pagesIdx} 0 R >>`);
    const info = add(`<< /Title (${encode(this.opts.title)}) /Producer (SIB pdf-lite) /CreationDate (D:${generated.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'binary')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'binary');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'binary');
  }
}
/** The title page block: subtitle and the generated line, after the title. */
export function reportHead(pdf: PdfLite, title: string, subtitle: string): void {
  pdf.h1(title); if (subtitle) pdf.p(subtitle, { size: 10, ink: [0.35, 0.35, 0.35] });
  pdf.p(`Report generated ${new Date().toUTCString()}. Applied Materials Strictly Confidential.`, { size: 8, ink: [0.45, 0.45, 0.45] });
}
