// iconography.mjs — generate the AppliedX icon library from the code.
//
//   node scripts/iconography.mjs          (npm run icons:doc)
//
// Reads sib/roadmap-client/src/utils/icons.ts (ICON_PATHS + ICON_META) and
// writes:
//   docs/ICONOGRAPHY.md      — table: name · label · group · used in · path
//   docs/iconography.html    — rendered sheet, day / night / on-card previews
//
// The doc is generated, never hand-edited: the source of truth is icons.ts.
// Also checks every path has meta and every meta has a path (exit 1 if not).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = join(ROOT, 'sib/roadmap-client/src/utils/icons.ts');
const src  = readFileSync(SRC, 'utf8');

// Tiny parser for the two object literals — keys are identifiers or quoted
// strings, path values are single-quoted strings, meta values are objects.
function block(name) {
  const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`${name} not found in icons.ts`);
  return m[1];
}
const paths = {};
for (const m of block('ICON_PATHS').matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*'([^']+)'\s*,/gm)) {
  paths[m[1] ?? m[2]] = m[3];
}
const meta = {};
for (const m of block('ICON_META').matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*\{\s*label:\s*'([^']+)',\s*group:\s*'([^']+)',\s*usedIn:\s*\[([^\]]*)\]/gm)) {
  meta[m[1] ?? m[2]] = { label: m[3], group: m[4], usedIn: [...m[5].matchAll(/'([^']+)'/g)].map(x => x[1]) };
}

let bad = 0;
for (const n of Object.keys(paths)) if (!meta[n]) { console.error(`icons.ts: ${n} has a path but no ICON_META entry`); bad++; }
for (const n of Object.keys(meta))  if (!paths[n]) { console.error(`icons.ts: ${n} has meta but no path`); bad++; }
if (bad) process.exit(1);

const names = Object.keys(paths);
const groups = [
  ['node', 'Node icons — pickable in the Inspector'],
  ['step', 'Step content glyphs — procedure node pill'],
  ['ui',   'UI chrome — toolbar, map list, panels, issues'],
];
const stamp = new Date().toISOString().slice(0, 10);

// ── Markdown ────────────────────────────────────────────────────────────────
let md = `# AppliedX iconography\n\n`;
md += `Generated ${stamp} from \`sib/roadmap-client/src/utils/icons.ts\` by \`npm run icons:doc\` — do not edit by hand.\n\n`;
md += `${names.length} icons · 24×24 grid · 2 px round strokes · \`stroke=currentColor\`, \`fill=none\`. `;
md += `Rendered in-app by \`components/Icon.tsx\`; node cards draw the same path in white at 0.75 scale. `;
md += `Rendered sheet: [docs/iconography.html](iconography.html).\n\n`;
md += `## Rules\n\n`;
md += `- One path per icon, drawn on the 24-grid with 2 px optical weight; no fills, no emoji, no icon fonts.\n`;
md += `- Names are lowercase, hyphenated; step glyphs are prefixed \`step-\`.\n`;
md += `- Fab vocabulary first: chamber, wafer, gas line, breaker, torque, lockout, evidence, ME, technician, Production #.\n`;
md += `- Add an icon → add path + meta in icons.ts → \`npm run icons:doc\` → \`npm run build:roadmap\`.\n\n`;
for (const [g, title] of groups) {
  md += `## ${title}\n\n| Name | Label | Used in | Path |\n|---|---|---|---|\n`;
  for (const n of names.filter(n => meta[n].group === g)) {
    md += `| \`${n}\` | ${meta[n].label} | ${meta[n].usedIn.join(', ')} | \`${paths[n]}\` |\n`;
  }
  md += '\n';
}
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs/ICONOGRAPHY.md'), md);

// ── HTML sheet ──────────────────────────────────────────────────────────────
const svg = (n, color, sw = 2) =>
  `<svg viewBox="0 0 24 24" width="24" height="24"><path d="${paths[n]}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const card = n => `
  <div class="ic" title="${meta[n].usedIn.join(', ')}">
    <div class="prev">
      <span class="day">${svg(n, '#475569')}</span>
      <span class="night">${svg(n, '#e5e9f2')}</span>
      <span class="oncard">${svg(n, '#ffffff')}</span>
    </div>
    <div class="nm"><code>${n}</code></div>
    <div class="lb">${meta[n].label}</div>
  </div>`;
let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AppliedX iconography</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --bg:#f8fafc; --text:#1e293b; --muted:#64748b; --border:#e2e8f0; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:28px 32px 12px; }
  h1 { margin:0 0 6px; font-size:22px; } h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:28px 32px 10px; }
  .sub { color:var(--muted); font-size:13px; margin:0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; padding:0 32px; }
  .ic { background:#fff; border:1px solid var(--border); border-radius:12px; padding:10px; }
  .prev { display:flex; gap:6px; margin-bottom:8px; }
  .prev span { flex:1; display:grid; place-items:center; height:40px; border-radius:8px; }
  .day { background:#f1f5f9; } .night { background:#0f172a; } .oncard { background:#1d4ed8; }
  .nm code { font-size:11.5px; } .lb { font-size:12px; color:var(--muted); margin-top:2px; }
  .legend { display:flex; gap:14px; font-size:12px; color:var(--muted); padding:8px 32px 0; }
  .legend i { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-2px; margin-right:4px; }
  footer { padding:24px 32px; font-size:12px; color:var(--muted); }
</style></head><body>
<header><h1>AppliedX iconography</h1>
<p class="sub">${names.length} icons · generated ${stamp} from <code>sib/roadmap-client/src/utils/icons.ts</code> · Proprietary &amp; Confidential · Applied Materials</p></header>
<div class="legend"><span><i style="background:#f1f5f9;border:1px solid #e2e8f0"></i>Day panel</span><span><i style="background:#0f172a"></i>Night panel</span><span><i style="background:#1d4ed8"></i>On a node card</span></div>`;
for (const [g, title] of groups) {
  html += `<h2>${title}</h2><div class="grid">${names.filter(n => meta[n].group === g).map(card).join('')}</div>`;
}
html += `<footer>Rules: one path per icon on the 24-grid, 2 px round strokes, stroke=currentColor, fill=none. No emoji, no icon fonts. Hover a card for where the icon is used. Regenerate with <code>npm run icons:doc</code>.</footer></body></html>`;
writeFileSync(join(ROOT, 'docs/iconography.html'), html);
console.log(`iconography: ${names.length} icons → docs/ICONOGRAPHY.md, docs/iconography.html`);
