// AR Client — main entry point
// Bootstraps camera, then routes to Author or Operator mode after role selection + QR scan.

import { ThreeRenderer } from './renderer/three-renderer.js';
import { QRScanner } from './ui/qr-scanner.js';
import { AuthorMode } from './modes/author-mode.js';
import { OperatorMode } from './modes/operator-mode.js';
import { DeviceOrientationEngine } from './engines/device-orientation-engine.js';
import type { QRAnchorContext } from '@spatial/shared';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas       = document.getElementById('ar-canvas')     as HTMLCanvasElement;
const videoEl      = document.getElementById('camera-feed')   as HTMLVideoElement;
const qrOverlay    = document.getElementById('qr-overlay')    as HTMLCanvasElement;
const statusEl     = document.getElementById('status')        as HTMLDivElement;
const resultBanner = document.getElementById('result-banner') as HTMLDivElement;
const roleScreen   = document.getElementById('role-screen')   as HTMLDivElement;
const qrScreen     = document.getElementById('qr-screen')     as HTMLDivElement;
const btnAuthor    = document.getElementById('btn-author')     as HTMLButtonElement;
const btnOperator  = document.getElementById('btn-operator')   as HTMLButtonElement;
const btnCapture   = document.getElementById('btn-capture')    as HTMLButtonElement;
const btnReset     = document.getElementById('btn-reset')      as HTMLButtonElement;
const actionBar    = document.getElementById('action-bar')     as HTMLDivElement;

function setStatus(msg: string) { statusEl.textContent = msg; }

function showResult(status: 'PASS' | 'FAIL', confidence: number) {
  resultBanner.textContent = `${status}  ${(confidence * 100).toFixed(0)}%`;
  resultBanner.className   = status === 'PASS' ? 'pass' : 'fail';
  resultBanner.style.display = 'block';
  setTimeout(() => { resultBanner.style.display = 'none'; }, 3500);
}

// ── Camera bootstrap ──────────────────────────────────────────────────────────
async function startCamera(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.style.display = 'block';
  await new Promise<void>(r => { videoEl.onloadedmetadata = () => r(); });
  return stream;
}

// ── QR scan ───────────────────────────────────────────────────────────────────
async function scanQR(): Promise<QRAnchorContext> {
  qrScreen.style.display = 'flex';
  qrOverlay.style.display = 'block';

  const scanner = new QRScanner(videoEl, qrOverlay);
  const context = await scanner.scan();
  scanner.stop();

  qrScreen.style.display = 'none';
  qrOverlay.style.display = 'none';
  return context;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  setStatus('Starting camera…');

  // Hide action bar until a mode is active
  actionBar.style.display = 'none';

  try {
    await startCamera();
  } catch {
    setStatus('Camera access denied — please allow camera and reload');
    return;
  }

  const renderer = new ThreeRenderer({ canvas });
  renderer.renderer.setClearAlpha(0);
  renderer.renderer.setClearColor(0x000000, 0);

  setStatus('Select a role to begin');

  // ── Role selection ──────────────────────────────────────────────────────────
  // DeviceOrientationEvent.requestPermission() MUST be called synchronously
  // inside a tap handler on iOS — so we do it here, right in the click callback,
  // before any awaits. We then pass the started engine into AuthorMode.
  let orientationEngine: DeviceOrientationEngine | null = null;

  const role = await new Promise<'author' | 'operator'>(resolve => {
    btnAuthor.addEventListener('click', async () => {
      // Request motion permission immediately — this IS the user gesture
      const granted = await DeviceOrientationEngine.requestPermission();
      if (granted) {
        orientationEngine = new DeviceOrientationEngine(renderer.camera);
        orientationEngine.start();
        renderer.onUpdate(() => orientationEngine?.update());
      } else {
        setStatus('Motion permission denied — honeycomb alignment may not work');
      }
      resolve('author');
    }, { once: true });

    btnOperator.addEventListener('click', async () => {
      // Request motion permission in the same user-gesture context (iOS 13+ requirement).
      // Without this the camera quaternion stays at identity, making QR-relative
      // tag position reconstruction wrong (tags appear at the bottom / behind).
      const granted = await DeviceOrientationEngine.requestPermission();
      if (granted) {
        orientationEngine = new DeviceOrientationEngine(renderer.camera);
        orientationEngine.start();
        renderer.onUpdate(() => orientationEngine?.update());
      }
      resolve('operator');
    }, { once: true });
  });

  roleScreen.style.display = 'none';
  setStatus('Scan the asset QR code…');

  // ── QR scan ─────────────────────────────────────────────────────────────────
  let qrContext: QRAnchorContext;
  try {
    qrContext = await scanQR();
    // Capture the camera quaternion at the moment the QR was decoded.
    // Author mode stores tag positions relative to this orientation;
    // Operator mode uses it to reconstruct those positions in its own frame.
    const q = renderer.camera.quaternion;
    qrContext.scanQuaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
    setStatus(`Asset: ${qrContext.assetId} — Anchor: ${qrContext.anchorId.slice(0, 8)}…`);
  } catch (err) {
    setStatus(`QR scan failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Launch mode ─────────────────────────────────────────────────────────────
  actionBar.style.display = 'flex';

  if (role === 'author') {
    const author = new AuthorMode(renderer, videoEl, {
      onStatus:   setStatus,
      onComplete: () => {
        setStatus('Training complete! Reload to start Operator mode.');
        btnReset.style.display = 'block';
      },
      onError: msg => setStatus(`Error: ${msg}`),
    }, orientationEngine);

    // Hide capture + reset while author mode is running its own flow
    btnCapture.style.display = 'none';
    btnReset.style.display   = 'none';

    await author.start(qrContext);

    btnReset.addEventListener('click', () => { author.stop(); location.reload(); }, { once: true });

  } else {
    const operator = new OperatorMode(renderer, videoEl, btnCapture, {
      onStatus: setStatus,
      onResult: (status, confidence) => showResult(status, confidence),
      onError:  msg => setStatus(`Error: ${msg}`),
    });

    // Hide place-tag in operator mode
    document.getElementById('btn-place-tag')!.style.display = 'none';

    await operator.start(qrContext);

    btnReset.addEventListener('click', () => { operator.stop(); location.reload(); }, { once: true });
  }
}

main().catch(err => {
  console.error('[main]', err);
  setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
});
