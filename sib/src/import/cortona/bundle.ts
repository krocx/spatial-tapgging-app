// bundle.ts - extract the Cortona3D Solo scene bundle from a published .htm.
//
// A single-file RapidManual publication (SingleHTMLBundle=Yes) carries its
// scene as an inline <script type="application/solo+zip"> whose body is a
// base64 data: URI. Decoded, it is a small ZIP with (per the two office
// reconnaissance reports) 3–5 entries:
//   <title>.wrl                gzip VRML97, one merged scene incl. PROTOs + Procedure
//   <title>.interactivity.xml  step/action index + DocItems part table
//   <title>.xml                the "rwi" job/task/BOM list (NOT a step source)
//   *.svg                      web renderings of 2D CGM illustrations (optional)
//
// Everything is sniffed by magic bytes, never by extension - one archive
// entry in the .vmp is XML wearing a .wrl extension, and we refuse to repeat
// that mistake on the published side.

import { isZip, readZip, ungzipIfNeeded, type ZipEntry } from './zip-lite.js';

export interface CortonaBundle {
  /** Decoded (gunzipped) VRML97 scene - kept as bytes; the parser tokenizes the buffer directly. */
  vrmlText:      Buffer;
  vrmlName:      string;
  /** interactivity.xml text, if present. */
  interactivity?: string;
  /** rwi step-list/BOM xml text, if present. */
  rwi?:          string;
  /** SVG illustrations (name → text). */
  svgs:          Record<string, string>;
  /** Every entry's name + kind + size, for the content-free import log. */
  inventory:     { name: string; kind: string; bytes: number }[];
}

const SOLO_SCRIPT = /<script[^>]*type=["']application\/solo\+zip["'][^>]*>([\s\S]*?)<\/script>/i;
const DATA_URI    = /data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)/;

export function sniffKind(buf: Buffer): 'gzip' | 'zip' | 'vrml' | 'xml' | 'svg' | 'html' | 'binary' {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  if (isZip(buf)) return 'zip';
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;   // UTF-8 BOM (seen on DITA task xml)
  const head = buf.subarray(bom, bom + 512).toString('latin1');
  if (head.startsWith('#VRML')) return 'vrml';
  const t = head.trimStart();
  if (/^<\?xml/i.test(t) || t.startsWith('<')) {
    if (/<svg[\s>]/i.test(head)) return 'svg';
    if (/<html[\s>]|<!doctype html/i.test(head)) return 'html';
    return 'xml';
  }
  return 'binary';
}

/** Find and decode the solo+zip payload inside a published .htm. */
export function extractSoloZip(htm: Buffer | string): Buffer {
  const text = typeof htm === 'string' ? htm : htm.toString('utf8');
  const m = SOLO_SCRIPT.exec(text);
  if (!m) {
    // Multi-file publication (SingleHTMLBundle=No): the .htm is only a viewer
    // launcher that points at <title>.interactivity.xml beside it.
    if (/Cortona3DSolo\.uniview|src:\s*['"][^'"]*\.interactivity\.xml['"]/i.test(text)) {
      throw new Error('cortona: this .htm is a multi-file publication launcher (no embedded scene). ' +
        'Zip the whole publication folder (the .htm together with its .interactivity.xml, .wrl and .xml files) and import the .zip instead');
    }
    throw new Error('cortona: no <script type="application/solo+zip"> block found in the .htm');
  }
  const d = DATA_URI.exec(m[1]);
  const b64 = (d ? d[1] : m[1]).replace(/\s+/g, '');
  const zip = Buffer.from(b64, 'base64');
  if (!isZip(zip)) throw new Error('cortona: solo+zip payload is not a ZIP');
  return zip;
}

/** Accepts either a published .htm or an already-extracted bundle ZIP. */
export function readCortonaBundle(input: Buffer): CortonaBundle {
  const kind = sniffKind(input);
  const zip  = kind === 'zip' ? input : kind === 'html' ? extractSoloZip(input) : null;
  if (!zip) throw new Error(`cortona: expected a published .htm or a bundle ZIP, got ${kind}`);

  const entries = readZip(zip);
  const bundle: CortonaBundle = { vrmlText: Buffer.alloc(0), vrmlName: '', svgs: {}, inventory: [] };

  for (const e of entries) classify(e, bundle);
  if (!bundle.vrmlText.length) throw new Error('cortona: bundle contains no VRML97 scene');
  return bundle;
}

function classify(e: ZipEntry, b: CortonaBundle): void {
  const data = ungzipIfNeeded(e.data);
  const kind = sniffKind(data);
  b.inventory.push({ name: e.name, kind, bytes: data.length });
  const lower = e.name.toLowerCase();
  if (kind === 'vrml') {
    if (b.vrmlText.length) throw new Error('cortona: more than one VRML scene in bundle');
    b.vrmlText = data; b.vrmlName = e.name;
  } else if (kind === 'svg') {
    b.svgs[e.name] = data.toString('utf8');
  } else if (kind === 'xml') {
    const text = data.toString('utf8');
    if (lower.endsWith('.interactivity.xml') || /<SimulationInteractivity[\s>]/.test(text.slice(0, 4000))) {
      b.interactivity = text;
    } else if (/<rwi[\s>]/.test(text.slice(0, 2000))) {
      b.rwi = text;
    } else if (!b.interactivity && /<Procedure[\s>]/.test(text.slice(0, 20000))) {
      b.interactivity = text;
    }
    // any other XML: inventoried, ignored
  }
}
