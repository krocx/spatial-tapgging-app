// Type declarations for AR.js (loaded as a CDN script — not an npm package).
// AR.js exposes its API under window.THREEx at runtime.
// These are minimal stubs for Phase 1; expand as needed.

declare namespace THREEx {
  class ArToolkitSource {
    constructor(parameters: {
      sourceType: 'webcam' | 'image' | 'video';
      sourceWidth?: number;
      sourceHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
    });
    init(onReady: () => void, onError?: (err: unknown) => void): void;
    onResizeElement(): void;
    copyElementSizeTo(element: HTMLElement): void;
    hasMobileTorch(): boolean;
    toggleMobileTorch(): void;
    ready: boolean;
    domElement: HTMLVideoElement;
  }

  class ArToolkitContext {
    constructor(parameters: {
      cameraParametersUrl?: string;
      detectionMode?: 'mono' | 'color' | 'color_and_matrix' | 'mono_and_matrix';
      maxDetectionRate?: number;
      canvasWidth?: number;
      canvasHeight?: number;
    });
    init(onCompleted?: () => void): void;
    update(srcElement: HTMLElement): void;
    getProjectionMatrix(): THREE.Matrix4;
  }

  class ArMarkerControls {
    constructor(
      context: ArToolkitContext,
      object3d: THREE.Object3D,
      parameters: {
        type: 'pattern' | 'barcode' | 'unknown';
        patternUrl?: string;
        barcodeValue?: number;
        changeMatrixMode?: 'cameraTransformMatrix' | 'modelViewMatrix';
        minConfidence?: number;
      }
    );
  }
}

interface Window {
  THREEx: typeof THREEx;
}
