import { createApp } from './app.js';
import { networkInterfaces } from 'os';
import { compareAgainstPassState } from './perception/image-comparator.js';

const PORT = process.env.PORT ?? 3001;
// Bind to 0.0.0.0 so the iPhone on the same WiFi can reach the Macbook SIB server.
const HOST = '0.0.0.0';

const app = createApp();

app.listen(Number(PORT), HOST, () => {
  console.log(`SIB v0.2 running on ${HOST}:${PORT}`);

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
    lanAddresses.forEach(ip => console.log(`   http://${ip}:${PORT}`));
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
