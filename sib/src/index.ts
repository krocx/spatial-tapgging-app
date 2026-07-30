import './load-config.js';           // MUST be first — loads sib-config.env into process.env (no-op on Render)
import { createApp } from './app.js';
import { attachMindmapWs } from './ws/mindmap.ws.js';
import { networkInterfaces } from 'os';
import { compareAgainstPassState } from './perception/image-comparator.js';
import http  from 'http';
import https from 'https';
import fs    from 'fs';

const PORT = Number(process.env.PORT ?? 3001);
// Bind to 0.0.0.0 so the iPhone on the same WiFi can reach the Macbook SIB server.
const HOST = process.env.HOST?.trim() || '0.0.0.0';

const cert = process.env.SSL_CERT_PATH?.trim();
const key  = process.env.SSL_KEY_PATH?.trim();

const app    = createApp();
const server = (cert && key)
  ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, app)
  : http.createServer(app);

const protocol = (cert && key) ? 'https' : 'http';

// Roadmap Mind-Mapper real-time collaboration (WebSocket upgrade on /mindmap/ws).
attachMindmapWs(server);

server.listen(PORT, HOST, () => {
  console.log(`SIB v0.2 running on ${HOST}:${PORT} (${protocol.toUpperCase()})`);

  // Print all LAN addresses so you can copy the correct one into the iOS app Settings.
  const nets = networkInterfaces();
  const lanAddresses: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        lanAddresses.push(net.address);
      }
    }
  }
  if (lanAddresses.length > 0) {
    console.log('📱 iPhone SIB URL candidates:');
    lanAddresses.forEach(ip => console.log(`   ${protocol}://${ip}:${PORT}`));
  }

  // Pre-warm V8's JIT compiler for the comparator's math-heavy loops.
  // Without this, the first operator inspection after a fresh deployment
  // takes ~41s (V8 interpreting code it hasn't seen yet). After this
  // completes, all subsequent inspections take ~2s (JIT-compiled machine code).
  setTimeout(() => { void warmUpComparator(); }, 500);
});

async function warmUpComparator(): Promise<void> {
  // A minimal 1×1 PNG — Jimp upscales it to the 256×256 working canvas,
  // which is enough for V8 to JIT-compile all Float32Array loops in
  // image-comparator.ts before any real operator inspection arrives.
  const dummy =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  try {
    await compareAgainstPassState([dummy], dummy);
    console.log('[warmup] Comparator pre-warmed — first inspection will be fast.');
  } catch {
    // Warm-up failure must never prevent the server from serving real requests.
  }
}
