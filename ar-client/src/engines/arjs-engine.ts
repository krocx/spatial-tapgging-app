// AR.js Engine — iOS Safari
// AR.js does not support WebXR hit-testing on iOS, so we use marker-based
// or image-tracking mode via the AR.js Three.js build (loaded via CDN in index.html).
//
// Strategy for Phase 1:
//   - Open the device camera via AR.js ArToolkitSource
//   - Detect a flat surface indicator (marker or manual tap-to-place)
//   - Feed the camera transform to Three.js for rendering
//
// Note: AR.js window.THREEx is typed in src/types/arjs.d.ts

import * as THREE from 'three';
import type { ThreeRenderer } from '../renderer/three-renderer.js';

export class ARJSEngine {
  private arToolkitSource: THREEx.ArToolkitSource | null = null;
  private arToolkitContext: THREEx.ArToolkitContext | null = null;
  private markerRoot: THREE.Group;
  private ready = false;

  constructor(private readonly threeRenderer: ThreeRenderer) {
    // markerRoot is the scene node whose transform AR.js will update each frame.
    // Attach tag indicators as children of markerRoot.
    this.markerRoot = new THREE.Group();
    this.threeRenderer.add(this.markerRoot);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get sceneRoot(): THREE.Group {
    return this.markerRoot;
  }

  async start(): Promise<void> {
    if (!window.THREEx) {
      throw new Error(
        'AR.js (window.THREEx) not loaded. Ensure the CDN script in index.html executed before start().',
      );
    }

    return new Promise((resolve, reject) => {
      // --- Toolkit Source (webcam) ---
      this.arToolkitSource = new window.THREEx.ArToolkitSource({
        sourceType: 'webcam',
        sourceWidth: window.innerWidth,
        sourceHeight: window.innerHeight,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight,
      });

      this.arToolkitSource.init(
        () => {
          this.onSourceReady();
          resolve();
        },
        (err) => {
          console.error('[ARJSEngine] source init error', err);
          reject(err);
        },
      );

      // --- Toolkit Context ---
      this.arToolkitContext = new window.THREEx.ArToolkitContext({
        cameraParametersUrl:
          'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
      });

      this.arToolkitContext.init(() => {
        // Sync AR.js projection matrix → Three.js camera
        this.threeRenderer.camera.projectionMatrix.copy(
          this.arToolkitContext!.getProjectionMatrix(),
        );
      });

      // --- Marker Controls (Hiro pattern for Phase 1) ---
      // TODO Phase 2: replace with image target / surface detection
      new window.THREEx.ArMarkerControls(this.arToolkitContext, this.markerRoot, {
        type: 'pattern',
        patternUrl:
          'https://raw.githack.com/AR-js-org/AR.js/master/data/data/patt.hiro',
        changeMatrixMode: 'modelViewMatrix',
      });

      // Register per-frame update
      this.threeRenderer.onUpdate((_delta) => this.tick());
      this.threeRenderer.start();
    });
  }

  stop(): void {
    this.threeRenderer.stop();
    this.ready = false;
  }

  private onSourceReady(): void {
    // Resize the AR.js video element to match viewport
    this.arToolkitSource!.onResizeElement();
    this.arToolkitSource!.copyElementSizeTo(
      this.threeRenderer.renderer.domElement,
    );
    this.ready = true;
  }

  private tick(): void {
    if (!this.arToolkitSource?.ready) return;

    // Resize on each frame to handle orientation changes
    if (this.arToolkitSource.domElement.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) return;

    this.arToolkitContext!.update(this.arToolkitSource.domElement);
  }
}
