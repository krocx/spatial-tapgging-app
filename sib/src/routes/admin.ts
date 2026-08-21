// admin.ts — production-ops routes. Everything under /admin is gated by the
// admin key (middleware/auth.ts isAdminRequest) on TOP of the API key.
//
// GET /admin/backup?scope=data|full → streamed .tar.gz of the data directory.
//   data (default): the JSON stores only — small, take one weekly.
//   full:           the entire data dir — evidence photos, world maps, models,
//                   QR images, step images. Can be large; take before upgrades.
//
// Restore is DELIBERATELY not an endpoint: it is a documented manual procedure
// (stop service → unpack over the data dir → start service). A restore button
// on a web page is a footgun. See docs/INTERNAL-SERVER-DEPLOY.md §Backups.
//
// Uses the system `tar` binary (streamed, no archiver dependency): present on
// Linux, Render's image, macOS, and Windows 10/Server 2019+.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');

const router = Router();

router.get('/backup', (req: Request, res: Response): void => {
  const scope = req.query.scope === 'full' ? 'full' : 'data';

  if (!fs.existsSync(DATA_DIR)) {
    res.status(404).json({ error: 'Data directory not found on this deployment' });
    return;
  }

  // data scope: top-level *.json stores only. full scope: everything.
  let entries: string[];
  if (scope === 'data') {
    entries = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    if (entries.length === 0) {
      res.status(404).json({ error: 'No JSON stores found to back up' });
      return;
    }
  } else {
    entries = ['.'];
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `sib-backup-${scope}-${stamp}.tar.gz`;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const tar = spawn('tar', ['-czf', '-', '-C', DATA_DIR, ...entries]);
  tar.stdout.pipe(res);
  tar.stderr.on('data', d => console.warn(`[backup] tar: ${String(d).trim()}`));
  tar.on('error', err => {
    // tar binary missing — old Windows. Fail loudly with the remedy.
    console.error('[backup] tar spawn failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'tar is not available on this server — install bsdtar or back up the data directory manually' });
    } else {
      res.destroy();
    }
  });
  tar.on('close', code => {
    if (code !== 0) console.warn(`[backup] tar exited with code ${code}`);
    console.log(`[backup] ${scope} backup streamed (${filename})`);
  });
  // Client gave up mid-download — don't leave tar running.
  res.on('close', () => { if (tar.exitCode === null) tar.kill(); });
});

export default router;
