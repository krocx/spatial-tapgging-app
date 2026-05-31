import { createApp } from './app.js';
import { networkInterfaces } from 'os';

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
});
