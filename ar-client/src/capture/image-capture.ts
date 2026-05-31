// Image Capture — grabs a frame from the live camera feed.
// Returns a base64-encoded JPEG string ready to send to SIB /perception/analyze-image.
//
// On WebXR (Android): reads from the renderer canvas (which includes the passthrough feed).
// On AR.js (iOS): reads from the AR.js video element + composites the Three.js canvas on top.

export interface CaptureResult {
  imageBase64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  capturedAt: string; // ISO 8601
}

export class ImageCapture {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly videoElement?: HTMLVideoElement,
  ) {}

  // Capture the current AR frame as a JPEG.
  capture(quality = 0.85): CaptureResult {
    let sourceCanvas: HTMLCanvasElement;

    if (this.videoElement) {
      // iOS / AR.js path: composite video + Three.js overlay into an offscreen canvas.
      sourceCanvas = this.compositeFrame();
    } else {
      // Android / WebXR path: the main canvas already contains the camera feed + overlay.
      sourceCanvas = this.canvas;
    }

    const dataUrl = sourceCanvas.toDataURL('image/jpeg', quality);
    // Strip the "data:image/jpeg;base64," prefix — SIB expects raw base64.
    const imageBase64 = dataUrl.split(',')[1] ?? '';

    return {
      imageBase64,
      mimeType: 'image/jpeg',
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      capturedAt: new Date().toISOString(),
    };
  }

  private compositeFrame(): HTMLCanvasElement {
    const offscreen = document.createElement('canvas');
    offscreen.width = this.canvas.width;
    offscreen.height = this.canvas.height;
    const ctx = offscreen.getContext('2d')!;

    // Draw camera background
    if (this.videoElement) {
      ctx.drawImage(this.videoElement, 0, 0, offscreen.width, offscreen.height);
    }

    // Draw Three.js overlay on top
    ctx.drawImage(this.canvas, 0, 0, offscreen.width, offscreen.height);

    return offscreen;
  }
}
