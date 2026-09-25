#!/usr/bin/env node
// brand-icons.mjs - build the SIB icon sprite:  npm run brand:icons
//
// Source of truth: sib/roadmap-client/src/utils/icons.ts (ICON_PATHS - the
// AppliedX icon library the Procedure Designer already draws with) plus the
// UI set below, which replaces every emoji the web pages used as an icon
// (charts, XR, share, move, copy, map, refresh, delete, lock, edit, …).
// Output: sib/portal/brand/icons.svg - <symbol id="i-<name>" viewBox="0 0 24 24">.
// Use:    <svg class="ax-icon"><use href="/portal/brand/icons.svg#i-check"/></svg>
//
// All paths are our own, 24-grid, 1.5-px round strokes, currentColor.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'sib/roadmap-client/src/utils/icons.ts'), 'utf8');
const m = src.match(/export const ICON_PATHS[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!m) throw new Error('ICON_PATHS not found');
const paths = {};
for (const x of m[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*'([^']+)'\s*,/gm)) paths[x[1] ?? x[2]] = x[3];
// labels + groups from ICON_META (node = Procedure Designer nodes, step = step kinds, ui = designer chrome)
const meta = {};
const mm = src.match(/export const ICON_META[^=]*=\s*\{([\s\S]*?)\n\};/);
if (mm) for (const x of mm[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*\{\s*label:\s*'([^']*)'[^}]*group:\s*'([a-z]+)'/gm)) meta[x[1] ?? x[2]] = { label: x[3], group: x[4] };

// UI icons - the ones the web surfaces need that the designer library lacks.
const UI = {
  chart:        'M4 20V10M10 20V4M16 20v-7M22 20H2',
  intelligence: 'M9 4a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4h1V4H9zm6 0a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4h-1V4h1zM10 9h4M10 15h4',
  // Contextual hints - the same four-point sparkle the iPad app shows on its hint chip and the ✨ toggle.
  sparkles:     'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM5 17l.7 1.8L7.5 19.5l-1.8.7L5 22l-.7-1.8-1.8-.7 1.8-.7L5 17zM19 15l.6 1.4 1.4.6-1.4.6L19 19l-.6-1.4-1.4-.6 1.4-.6L19 15z',
  insights:     'M4 19h16M6 15l4-5 3 3 5-7M17 6h1v1',
  xr:           'M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3l-2-2h-4l-2 2H5a2 2 0 0 1-2-2V9zM8 11.5h.01M16 11.5h.01',
  share:        'M16 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm8 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM10.2 11l3.6-2.1M10.2 13l3.6 2.1',
  move:         'M4 8h13l-3-3M20 16H7l3 3',
  copy:         'M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M4 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z',
  'copy-all':   'M6 6h9v9H6zM9 9h9v9H9zM12 12h9v9h-9z',
  'map-reset':  'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14M17 3l4 4-4 4',
  download:     'M12 4v11m0 0-4-4m4 4 4-4M4 19h16',
  upload:       'M12 15V4m0 0L8 8m4-4 4 4M4 19h16',
  refresh:      'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  trash:        'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit:         'M4 20h4l11-11-4-4L4 16v4zM13 7l4 4',
  play:         'M7 5v14l11-7z',
  graph:        'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3zM12 3v18M4.2 7.5 12 12l7.8-4.5',
  steps:        'M4 6h16M4 12h10M4 18h13',
  search:       'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8',
  muted:        'M4 9v6h4l5 4V5L8 9H4zM16 8l5 8M21 8l-5 8',
  'lock-restricted': 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v3',
  unlock:       'M17 11V8a5 5 0 0 0-9.6-2M5 11h14v10H5zM12 15v3',
  close:        'M6 6l12 12M18 6 6 18',
  chevron:      'M9 6l6 6-6 6',
  back:         'M15 6l-6 6 6 6',
  next:         'M9 6l6 6-6 6',
  replay:       'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  external:     'M14 4h6v6M20 4l-9 9M18 13v6H5V6h6',
  home:         'M4 11l8-7 8 7v9h-5v-6H9v6H4v-9z',
  compass:      'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM15.5 8.5l-2 5-5 2 2-5 5-2z',
  logs:         'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  backup:       'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4V7zm0 5h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5zM7 15h2',
  users:        'M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6',
  config:       'M4 6h10M4 12h16M4 18h8M17 4v4M9 10v4M15 16v4',
  filter:       'M4 5h16l-6 7v6l-4 2v-8L4 5z',
  info:         'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
  'anchor-qr':  'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM6.5 6.5h1M16.5 6.5h1M6.5 16.5h1',
  mark:         'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M12 12h.01',
};
for (const k of Object.keys(UI)) if (paths[k]) console.warn(`note: UI icon "${k}" overrides a designer icon of the same name`);
const all = { ...paths, ...UI };

const symbols = Object.entries(all).map(([name, d]) =>
  `<symbol id="i-${name}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`).join('\n');
const out = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated by scripts/brand-icons.mjs - do not edit; ${Object.keys(all).length} icons (${Object.keys(paths).length} designer library + ${Object.keys(UI).length} UI) -->
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
${symbols}
</svg>
`;
writeFileSync(join(ROOT, 'sib/portal/brand/icons.svg'), out);
const UI_LABELS = { chart: 'Chart', intelligence: 'Intelligence', sparkles: 'Contextual hint', insights: 'Insights', xr: 'XR kit', share: 'Share', move: 'Move', copy: 'Copy', 'copy-all': 'Copy to all', 'map-reset': 'Reset map',
  download: 'Download', upload: 'Upload', refresh: 'Refresh', trash: 'Delete', edit: 'Edit', play: 'Preview', graph: 'Graph', steps: 'Steps', search: 'Search', muted: 'Muted',
  'lock-restricted': 'Restricted', unlock: 'Unlock', close: 'Close', chevron: 'Chevron', back: 'Back', next: 'Next', replay: 'Replay', external: 'Open', home: 'Home', compass: 'Compass',
  logs: 'Logs', backup: 'Backup', users: 'Users', config: 'Configuration', filter: 'Filter', info: 'Info', 'anchor-qr': 'Anchor QR', mark: 'Registration mark' };
const GROUP_NAMES = { node: 'Procedure Designer · nodes', step: 'Step kinds', ui: 'Designer chrome', web: 'Web UI (replaces emoji)' };
const manifest = Object.keys(all).map(name => ({ name, label: meta[name]?.label ?? UI_LABELS[name] ?? name, group: UI[name] ? 'web' : (meta[name]?.group ?? 'node') }));
writeFileSync(join(ROOT, 'sib/portal/brand/icons.json'), JSON.stringify({ groups: GROUP_NAMES, icons: manifest }, null, 0));
console.log(`✓ sib/portal/brand/icons.svg - ${Object.keys(all).length} icons`);
