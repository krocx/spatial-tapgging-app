// QR Scanner — uses jsQR to detect a QR code from the live camera feed.
// Resolves with a QRAnchorContext once a valid code containing
// { assetId, anchorId } is detected.
//
// Usage:
//   const scanner = new QRScanner(videoElement, overlayCanvas);
//   const context = await scanner.scan();   // resolves on first valid QR
//   scanner.stop();

import jsQR from 'jsqr';
import type { QRAnchorContext } from '@spatial/shared';

export class QRScanner {
  private animationId: number | null = null;
  private offscreen: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resolveRef: ((ctx: QRAnchorContext) => void) | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly overlay: HTMLCanvasElement,
  ) {
    this.offscreen = document.createElement('canvas');
    this.ctx = this.offscreen.getContext('2d', { willReadFrequently: true })!;
  }

  // Start scanning. Resolves once a valid QR is found.
  scan(): Promise<QRAnchorContext> {
    return new Promise(resolve => {
      this.resolveRef = resolve;
      this.tick();
    });
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.resolveRef = null;
    // Clear overlay
    const ctx = this.overlay.getContext('2d');
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private tick(): void {
    if (!this.resolveRef) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      const w = this.video.videoWidth;
      const h = this.video.videoHeight;
      this.offscreen.width  = w;
      this.offscreen.height = h;
      this.overlay.width    = this.video.clientWidth;
      this.overlay.height   = this.video.clientHeight;

      this.ctx.drawImage(this.video, 0, 0, w, h);
      const imageData = this.ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });

      if (code) {
        const context = this.parseQR(code.data);
        if (context) {
          this.drawCorners(code.location, w, h);
          this.resolveRef(context);
          this.resolveRef = null;
          return;
        }
      }
    }

    this.animationId = requestAnimationFrame(() => this.tick());
  }

  // Parse QR data — expects JSON { assetId, anchorId }
  private parseQR(raw: string): QRAnchorContext | null {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.assetId === 'string' && typeof parsed.anchorId === 'string') {
        return { assetId: parsed.assetId, anchorId: parsed.anchorId };
      }
    } catch {
      // Not JSON — ignore
    }
    return null;
  }

  // Draw a green box around the detected QR code corners on the overlay canvas
  private drawCorners(
    location: { topLeftCorner: {x:number;y:number}; topRightCorner: {x:number;y:number};
                bottomRightCorner: {x:number;y:number}; bottomLeftCorner: {x:number;y:number} },
    srcW: number,
    srcH: number,
  ): void {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;

    const scaleX = this.overlay.width  / srcW;
    const scaleY = this.overlay.height / srcH;

    const corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner,
    ];

    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners[0].x * scaleX, corners[0].y * scaleY);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x * scaleX, corners[i].y * scaleY);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

// Helper — generate a QR payload string for a given context.
// Use this to create printable QR codes for physical assets.
export function makeQRPayload(context: QRAnchorContext): string {
  return JSON.stringify(context);
}
