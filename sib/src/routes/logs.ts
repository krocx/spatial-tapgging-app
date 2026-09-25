// routes/logs.ts - QA logging endpoints (see logging/device-logs.ts).
//
//   POST /logs               { device, entries[] }  ← iOS AppLog batches (API-key gated like all writes)
//   GET  /logs               ?device&since&until&level&module&q&limit   → JSON lines   (admin gate)
//   GET  /logs/devices       → known devices, newest first                            (admin gate)
//   GET  /logs/export.txt    same filters → plain text download                         (admin gate)
//   GET  /logs/tail          SSE stream of new lines (?device=&level=)                  (admin gate)
//
// Reads sit behind the admin gate (middleware/auth.ts isAdminRequest) because
// lines carry employee ids and free-text context. On a keyless LAN server
// that gate is open, as everywhere else.

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  validateLogBatch, appendLogs, queryLogs, listLogDevices, formatLine, logEvents,
  LOG_LEVELS, type LogLevel, type StoredLine,
} from '../logging/device-logs.js';

const router = Router();

function parseQuery(req: Request) {
  const q = req.query as Record<string, string | undefined>;
  const level = q.level && (LOG_LEVELS as readonly string[]).includes(q.level) ? q.level as LogLevel : undefined;
  const limit = q.limit ? Number(q.limit) : undefined;
  return {
    device: q.device?.trim() || undefined,
    since:  q.since || undefined,
    until:  q.until || undefined,
    level,
    module: q.module?.trim().toLowerCase() || undefined,
    q:      q.q?.trim() || undefined,
    limit:  Number.isFinite(limit) ? limit : undefined,
  };
}

router.post('/', (req: Request, res: Response): void => {
  const v = validateLogBatch(req.body);
  if (v.ok === false) { res.status(400).json({ error: v.error, timestamp: new Date().toISOString() }); return; }
  try {
    const n = appendLogs(v.value);
    res.status(202).json({ data: { accepted: n }, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: `Log write failed: ${(err as Error).message}`, timestamp: new Date().toISOString() });
  }
});

router.get('/devices', (_req: Request, res: Response): void => {
  res.json({ data: listLogDevices(), timestamp: new Date().toISOString() });
});

router.get('/export.txt', (req: Request, res: Response): void => {
  const qry = parseQuery(req);
  const lines = queryLogs({ ...qry, limit: qry.limit ?? 5000 });
  const name = `sib-logs-${qry.device ?? 'all'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(lines.map(formatLine).join('\n') + '\n');
});

router.get('/tail', (req: Request, res: Response): void => {
  const qry = parseQuery(req);
  const minIdx = qry.level ? LOG_LEVELS.indexOf(qry.level) : 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const onLine = (line: StoredLine) => {
    if (qry.device && line.device !== qry.device) return;
    if (LOG_LEVELS.indexOf(line.level) < minIdx) return;
    if (qry.module && line.module !== qry.module) return;
    res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
  };
  logEvents.on('line', onLine);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { logEvents.off('line', onLine); clearInterval(ping); });
});

router.get('/', (req: Request, res: Response): void => {
  res.json({ data: queryLogs(parseQuery(req)), timestamp: new Date().toISOString() });
});

export default router;
