#!/usr/bin/env node
// vendor-brand-fonts.mjs — self-host Roboto + Roboto Mono:  npm run brand:fonts
//
// Asks Google Fonts for the woff2 CSS (a modern-browser UA gets the latin
// subset as woff2), downloads each face into sib/portal/brand/fonts/ under
// the names fonts.css expects, and never touches the CSS. Run once on a
// machine with internet; commit the files (Apache 2.0). The LAN server then
// serves the faces itself; brand.js stops reaching for fonts.googleapis.com.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sib/portal/brand/fonts');
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const FACES = [
  { family: 'Roboto',      weights: [400, 500, 700], file: w => `Roboto-${w}.woff2` },
  { family: 'Roboto Mono', weights: [400, 500],      file: w => `RobotoMono-${w}.woff2` },
];
for (const f of FACES) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@${f.weights.join(';')}&subset=latin&display=swap`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  for (const w of f.weights) {
    // Take the latin block for this weight (the CSS lists subsets in order; latin carries U+0000-00FF).
    const re = new RegExp(`font-weight: ${w};[\\s\\S]*?src: url\\(([^)]+)\\) format\\('woff2'\\);[\\s\\S]*?unicode-range: U\\+0000-00FF`, 'g');
    const m = re.exec(css);
    if (!m) { console.error(`✗ ${f.family} ${w}: latin woff2 not found in Google CSS`); process.exit(1); }
    const buf = Buffer.from(await (await fetch(m[1])).arrayBuffer());
    fs.writeFileSync(path.join(OUT, f.file(w)), buf);
    console.log(`↓ ${f.family} ${w} → brand/fonts/${f.file(w)} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}
console.log('✓ fonts vendored — commit sib/portal/brand/fonts/.');
