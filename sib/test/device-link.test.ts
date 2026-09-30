// device-link.test.ts - single-use, ten-minute links that open one guide on a
// headset without the site key (middleware/device-link.ts + the content gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mintDeviceLink, redeemDeviceLink, outstandingDeviceLinks } from '../src/middleware/device-link.js';

test('a link redeems once, for its guide only, and not after it is used', () => {
  const l = mintDeviceLink('g1', 'karthik@example.com', 'Karthik', 'quest-3');
  assert.equal(redeemDeviceLink(l.token, 'g2'), null, 'wrong guide');
  const r = redeemDeviceLink(l.token, 'g1');
  assert.ok(r && r.issuedName === 'Karthik' && r.profile === 'quest-3');
  assert.equal(redeemDeviceLink(l.token, 'g1'), null, 'second use');
  assert.equal(outstandingDeviceLinks(), 0);
});

const distReady = fs.existsSync(new URL('../dist/app.js', import.meta.url));
test('content gate: a locked server lets a device link through once, sets the cookie, keeps the operator hint', { skip: !distReady && 'run npm run build first' }, async () => {
  process.env.SIB_API_KEY = 'site-key-for-test';
  const { createApp } = await import('../dist/app.js');
  const { mintDeviceLink: mint } = await import('../dist/middleware/device-link.js');
  const app = createApp(); const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
  try {
    const l = mint('g1', 'portal', 'Karthik', 'quest-3');
    let r = await fetch(`http://127.0.0.1:${port}/xr?guide=g1&link=${l.token}`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location')!; assert.ok(loc.startsWith('/xr?') && !loc.includes('link=') && loc.includes('operator=Karthik') && loc.includes('profile=quest-3'), loc);
    assert.ok((r.headers.get('set-cookie') || '').includes('sib_key='), 'access cookie set');
    // Used: the same link now falls to the gate.
    r = await fetch(`http://127.0.0.1:${port}/xr?guide=g1&link=${l.token}`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.equal(r.status, 302); assert.ok(r.headers.get('location')!.startsWith('/unlock'), 'dead link goes to /unlock');
    // No link: the gate as before.
    r = await fetch(`http://127.0.0.1:${port}/xr?guide=g1`, { redirect: 'manual', headers: { accept: 'text/html' } });
    assert.ok(r.headers.get('location')!.startsWith('/unlock'));
  } finally { srv.close(); delete process.env.SIB_API_KEY; }
});
