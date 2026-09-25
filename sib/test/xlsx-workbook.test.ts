// xlsx-workbook.test.ts - G8: multi-sheet workbook with several images per row.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Minimal STORED-zip reader: name → Buffer. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const size = buf.readUInt32LE(off + 18), nameLen = buf.readUInt16LE(off + 26), extra = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const start = off + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size));
    off = start + size;
  }
  return out;
}

test('buildWorkbookXlsx: sheets, per-row multi-image anchors, global media numbering, AA+ columns', async () => {
  const { buildWorkbookXlsx } = await import('../src/oms/xlsx-lite.js');
  const jpg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, n]);
  const headers = Array.from({ length: 30 }, (_, i) => `C${i + 1}`);
  const buf = buildWorkbookXlsx([
    { name: 'Summary', headers: ['A', 'B'], rows: [{ cells: ['x', 1] }], colWidths: [10, 10], freezeHeader: true },
    { name: 'Findings', headers, rows: [
        { cells: headers.map((_, i) => `v${i}`), images: [{ col: 26, data: jpg(1) }, { col: 28, data: jpg(2) }] },
        { cells: ['plain'] },
      ], colWidths: headers.map(() => 8), freezeHeader: true },
    { name: 'Photos', headers: ['Cap', 'Photo'], rows: [{ cells: ['c', ''], image: jpg(3) }], colWidths: [20, 36], imgCol: 1 },
  ]);
  const z = unzip(buf);
  const wb = z.get('xl/workbook.xml')!.toString();
  assert.match(wb, /name="Summary" sheetId="1"/); assert.match(wb, /name="Findings" sheetId="2"/); assert.match(wb, /name="Photos" sheetId="3"/);
  // Summary has no drawing; Findings and Photos do; media numbered 1..3 across sheets.
  assert.ok(!z.has('xl/drawings/drawing1.xml'));
  const d2 = z.get('xl/drawings/drawing2.xml')!.toString();
  assert.equal((d2.match(/<xdr:oneCellAnchor>/g) ?? []).length, 2);
  assert.match(d2, /<xdr:col>26<\/xdr:col>/); assert.match(d2, /<xdr:col>28<\/xdr:col>/);
  assert.match(z.get('xl/drawings/_rels/drawing2.xml.rels')!.toString(), /image1\.jpeg.*image2\.jpeg/s);
  assert.match(z.get('xl/drawings/_rels/drawing3.xml.rels')!.toString(), /image3\.jpeg/);
  assert.ok(z.has('xl/media/image1.jpeg') && z.has('xl/media/image2.jpeg') && z.has('xl/media/image3.jpeg'));
  // AA/AB… cell references and frozen header pane.
  const s2 = z.get('xl/worksheets/sheet2.xml')!.toString();
  assert.match(s2, /<c r="AA2"/); assert.match(s2, /<c r="AD2"/);
  assert.match(s2, /state="frozen"/);
  assert.match(s2, /<row r="2" ht="140"/);                       // image row is tall
  assert.match(s2, /<row r="3"><c r="A3"/);                      // plain row is not
  const ct = z.get('[Content_Types].xml')!.toString();
  assert.equal((ct.match(/worksheets\/sheet\d\.xml/g) ?? []).length, 3);
  assert.equal((ct.match(/drawings\/drawing\d\.xml/g) ?? []).length, 2);
});
