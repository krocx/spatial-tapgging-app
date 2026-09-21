#!/usr/bin/env node
// brand-check.mjs — the design system is self-enforcing:  npm run brand:check
//
// Scans the GOVERNED files (pages that have adopted sib/portal/brand/) and
// fails on anything that would drift them back to a generic look:
//   · a hex / rgb colour outside tokens.css            (use var(--ax-…))
//   · an emoji used in markup or UI strings             (use the icon sprite)
//   · backdrop-filter / glass                           (no glass)
//   · linear-/radial-gradient on a surface              (repeating hairline grids are fine)
//   · box-shadow that is not a token ring/rim           (elevation is a hairline)
//   · a font-family that is not the brand stack         (Arial via tokens)
//   · border-radius above 4px                           (near-square corners)
//
// Add a page to GOVERNED when it migrates; the list grows, never shrinks.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOVERNED = [
  'sib/portal/brand/components.css',
  'sib/portal/brand/brand.css',
  'sib/portal/brand.html',
];
const TOKENS = 'sib/portal/brand/tokens.css';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]|[\u{2190}-\u{21FF}][\u{FE0F}]|\u{FE0F}/u;
const HEX   = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RGB   = /\brgba?\(/;
const rules = [
  { name: 'hex colour outside tokens',   test: l => HEX.test(l) && !/^\s*\/\//.test(l) && !/href=|id="|#i-/.test(l) },
  { name: 'rgb() colour outside tokens', test: l => RGB.test(l) },
  { name: 'emoji as icon',               test: l => EMOJI.test(l) },
  { name: 'backdrop-filter (glass)',     test: l => /backdrop-filter/.test(l) },
  { name: 'gradient on a surface',       test: l => /(?<!repeating-)(linear|radial)-gradient\(/.test(l) },
  { name: 'box-shadow not a token',      test: l => /box-shadow\s*:/.test(l) && !/var\(--ax-(ring|rim|shadow)\)|--ax-rim|0 0 0 1px var\(--ax-green\)/.test(l) },
  { name: 'font-family not the brand',   test: l => /font-family\s*:/.test(l) && !/var\(--ax-(font|mono)\)/.test(l) },
  { name: 'border-radius above 4px',     test: l => /border-radius\s*:\s*(\d+)px/.test(l) && +l.match(/border-radius\s*:\s*(\d+)px/)[1] > 4 && !/50%/.test(l) },
];

let findings = 0;
for (const rel of GOVERNED) {
  let text; try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (/brand-check: allow/.test(l)) return;
    for (const r of rules) if (r.test(l)) { findings++; console.log(`  ${rel}:${i + 1}  ${r.name}\n      ${l.trim().slice(0, 110)}`); }
  });
}
// tokens.css itself: every colour must sit on a `--ax-` line, and no orange may creep in.
const tok = readFileSync(join(ROOT, TOKENS), 'utf8').split('\n');
tok.forEach((l, i) => {
  if ((HEX.test(l) || RGB.test(l)) && !/^\s*--ax-/.test(l)) { findings++; console.log(`  ${TOKENS}:${i + 1}  colour not declared as a token\n      ${l.trim()}`); }
  const m = l.match(/--ax-(?!p-gemba)[a-z0-9-]+:\s*#([0-9a-fA-F]{6})/);
  if (m) { const [r, g, b] = [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16));
    if (r > 200 && g > 90 && g < 190 && b < 90) { findings++; console.log(`  ${TOKENS}:${i + 1}  orange-ish token (the system has no orange; only --ax-p-gemba may)\n      ${l.trim()}`); } }
});

if (findings) { console.log(`\n✗ brand-check: ${findings} finding(s)`); process.exit(1); }
console.log(`✓ brand-check: ${GOVERNED.length} governed file(s) + tokens — no drift`);
