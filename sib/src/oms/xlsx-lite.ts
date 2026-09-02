// xlsx-lite.ts — dependency-free XLSX writer for the Usage Log export.
//
// Why hand-rolled: the export must EMBED evidence photos per row, which the
// common zero-dependency CSV path cannot do and which would otherwise pull in
// exceljs. Like the tar-based backup (routes/admin.ts), this keeps the
// platform free of new runtime dependencies: an .xlsx is just a ZIP of XML
// parts, and we only need STORED (uncompressed) entries + a tiny CRC32.
//
// Scope is deliberately minimal: one sheet, inline strings, fixed column
// widths, one JPEG per row anchored in the Evidence column. Opens in Excel,
// Numbers and LibreOffice.

import fs from 'fs';
import path from 'path';
import type { OmsUsageSession } from '@spatial/shared';

// ── STORED-zip writer ────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Buffer; }

function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(0, 8);               // method: STORED
    local.writeUInt32LE(0, 10);              // time+date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);  // csize
    local.writeUInt32LE(e.data.length, 22);  // usize
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // extra len
    locals.push(local, nameBuf, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);            // made by
    central.writeUInt16LE(20, 6);            // needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);            // method
    central.writeUInt32LE(0, 12);            // time+date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attrs all zero (30..37)
    central.writeUInt32LE(0, 38);            // ext attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + e.data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ── XLSX assembly ────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const COLS = ['Production #', 'Guide', 'Operator', 'Employee ID', 'Session started',
              'Step', 'Entered', 'Duration (s)', 'Outcome', 'Validation', 'Evidence'];

const colLetter = (i: number) => String.fromCharCode(65 + i); // A..K (11 cols fits)

function cellStr(col: number, row: number, v: string): string {
  return `<c r="${colLetter(col)}${row}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
function cellNum(col: number, row: number, v: number): string {
  return `<c r="${colLetter(col)}${row}"><v>${v}</v></c>`;
}

const EVIDENCE_DIR = path.join(process.env.DATA_DIR ?? './data', 'guide-session-evidence');

/** Evidence photo for a step: live-upload dir (usage id) first, then the
 *  legacy sign-off dir. */
function evidencePath(usageId: string, signOffId: string | undefined, stepId: string): string | null {
  const live = path.join(EVIDENCE_DIR, usageId, `${stepId}.jpg`);
  if (fs.existsSync(live)) return live;
  if (!signOffId) return null;
  const p = path.join(EVIDENCE_DIR, signOffId, `${stepId}.jpg`);
  return fs.existsSync(p) ? p : null;
}

const EMU_PER_PX = 9525;
const IMG_W = 240, IMG_H = 180;        // px in the sheet — large enough to review
const IMG_ROW_HT = 140;                // pt — fits the 180px image

/** Build the Usage Log workbook: one row per step visit, evidence embedded. */
export function buildUsageXlsx(records: OmsUsageSession[]): Buffer {
  interface Img { rowIdx: number; data: Buffer; }
  const images: Img[] = [];
  const rows: string[] = [];

  // Header
  rows.push(`<row r="1">${COLS.map((c, i) => cellStr(i, 1, c)).join('')}</row>`);
  let r = 2;

  for (const u of records) {
    const base = (row: number) => [
      cellStr(0, row, u.workContext ?? ''),
      cellStr(1, row, u.guideName),
      cellStr(2, row, u.operatorName),
      cellStr(3, row, u.operatorEmployeeId ?? ''),
      cellStr(4, row, u.startedAt),
    ].join('');
    if (u.steps.length === 0) {
      rows.push(`<row r="${r}">${base(r)}${cellStr(8, r, u.completed ? 'signed off' : 'open')}</row>`);
      r++;
      continue;
    }
    for (const e of u.steps) {
      const val = e.validation
        ? `${e.validation.mode} ${e.validation.result}${e.validation.score !== undefined ? ` (${e.validation.score})` : ''}`
        : '';
      const evi = evidencePath(u.id, u.signOffSessionId, e.stepId);
      let cells = base(r)
        + (e.stepIndex !== undefined ? cellNum(5, r, e.stepIndex + 1) : cellStr(5, r, ''))
        + cellStr(6, r, e.enteredAt)
        + (e.durationSeconds !== undefined ? cellNum(7, r, e.durationSeconds) : cellStr(7, r, ''))
        + cellStr(8, r, e.outcome)
        + cellStr(9, r, val);
      if (evi) {
        images.push({ rowIdx: r - 1, data: fs.readFileSync(evi) });  // 0-based row for the anchor
        rows.push(`<row r="${r}" ht="${IMG_ROW_HT}" customHeight="1">${cells}</row>`);
      } else {
        rows.push(`<row r="${r}">${cells}</row>`);
      }
      r++;
    }
  }

  const colDefs =
    `<cols>` +
    [16, 28, 18, 12, 20, 6, 20, 11, 11, 20, 34]
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') +
    `</cols>`;

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    colDefs +
    `<sheetData>${rows.join('')}</sheetData>` +
    (images.length ? `<drawing r:id="rId1"/>` : '') +
    `</worksheet>`;

  // Drawing: one anchored JPEG per evidence row, in the Evidence column (K = col 10).
  const anchors = images.map((img, i) =>
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>10</xdr:col><xdr:colOff>${EMU_PER_PX * 4}</xdr:colOff>` +
    `<xdr:row>${img.rowIdx}</xdr:row><xdr:rowOff>${EMU_PER_PX * 3}</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${IMG_W * EMU_PER_PX}" cy="${IMG_H * EMU_PER_PX}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="Evidence ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
    `<xdr:clientData/></xdr:oneCellAnchor>`).join('');

  const drawing =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;

  const drawingRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    images.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
      `Target="../media/image${i + 1}.jpeg"/>`).join('') +
    `</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      (images.length ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '') +
      `</Types>`) },
    { name: '_rels/.rels', data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Usage Log" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ];
  if (images.length) {
    entries.push(
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>` +
        `</Relationships>`) },
      { name: 'xl/drawings/drawing1.xml', data: Buffer.from(drawing) },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: Buffer.from(drawingRels) },
      ...images.map((img, i) => ({ name: `xl/media/image${i + 1}.jpeg`, data: img.data })),
    );
  }
  return buildZip(entries);
}
