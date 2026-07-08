// load-config.ts — optional local config-file loader for on-prem deployments.
//
// Reads KEY=VALUE lines from a local .env-style file into process.env,
// but ONLY if the key is not already set — real environment variables always win.
//
// On Render (and any cloud deployment) the file won't exist → this is a no-op.
// On an air-gapped Windows/Linux server the file lives at:
//   $SIB_CONFIG_PATH   (explicit override), or
//   <repo-root>/sib-config.env  (default)
//
// Import this module FIRST in index.ts so all subsequent code sees the values.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve config file path: env override → default next to repo root
const cfg = process.env.SIB_CONFIG_PATH
  ? path.resolve(process.env.SIB_CONFIG_PATH)
  : path.resolve(__dirname, '..', '..', 'sib-config.env');

if (fs.existsSync(cfg)) {
  console.log(`[config] Loading config file: ${cfg}`);
  for (const raw of fs.readFileSync(cfg, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    // Real environment variables always win over the file.
    if (k && !process.env[k]) process.env[k] = v;
  }
} else {
  console.log('[config] No config file found — using environment variables only.');
}
