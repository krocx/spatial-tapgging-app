// WebXR Engine — Android Chrome
// Uses the WebXR Device API for immersive-ar hit-testing.
// Manages the XR session lifecycle and feeds pose data to ThreeRenderer.
//
// Assumptions:
//   - navigator.xr is available (Android Chrome 81+)
//   - 'hit-test' and 'dom-overlay' features are supported
//   - ThreeRenderer is already initialised

import * as THREE from 'three';
import type { ThreeRenderer } from '../renderer/three-renderer.js';

export interface HitResult {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export type HitTestCallback = (hit: HitResult | null) => void;

export class WebXREngine {
  private xrSession: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private referenceSpace: XRReferenceSpace | null = null;
  private reticle: THREE.Mesh;
  private onHitTest: HitTestCallback | null = null;

  constructor(private readonly threeRenderer: ThreeRenderer) {
    // Reticle — visual indicator of the detected surface plane
    const geo = new THREE.RingGeometry(0.05, 0.07, 32);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, side: THREE.DoubleSide });
    this.reticle = new THREE.Mesh(geo, mat);
    this.reticle.visible = false;
    this.threeRenderer.add(this.reticle);
  }

  get isSupported(): boolean {
    return 'xr' in navigator;
  }

  // Register a callback that fires on each frame with the latest hit-test result.
  onHitTestResult(cb: HitTestCallback): void {
    this.onHitTest = cb;
  }

  // Start the WebXR immersive-ar session.
  async start(): Promise<void> {
    if (!this.isSupported) {
      throw new Error('WebXR not supported on this device.');
    }

    const supported = await navigator.xr!.isSessionSupported('immersive-ar');
    if (!supported) {
      throw new Error('immersive-ar session not supported.');
    }

    // hit-test is optional so iOS Safari (which supports immersive-ar via ARKit
    // but may not expose hit-test) doesn't block session creation.
    this.xrSession = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: [],
      optionalFeatures: ['hit-test', 'dom-overlay', 'anchors'],
      domOverlay: { root: document.body },
    });

    this.threeRenderer.renderer.xr.setReferenceSpaceType('local');
    await this.threeRenderer.renderer.xr.setSession(this.xrSession);

    this.referenceSpace = await this.xrSession.requestReferenceSpace('local');

    const viewerSpace = await this.xrSession.requestReferenceSpace('viewer');
    this.hitTestSource = await this.xrSession.requestHitTestSource!({ space: viewerSpace })!;

    this.xrSession.addEventListener('end', () => this.onSessionEnd());

    // Register per-frame update with the renderer
    this.threeRenderer.onUpdate((_delta) => {
      this.tick();
    });

    this.threeRenderer.start();
  }

  async stop(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end();
    }
  }

  // Returns the current reticle world position — call this to place an anchor.
  getCurrentHitPosition(): THREE.Vector3 | null {
    if (!this.reticle.visible) return null;
    return this.reticle.position.clone();
  }

  getCurrentHitRotation(): THREE.Quaternion | null {
    if (!this.reticle.visible) return null;
    return this.reticle.quaternion.clone();
  }

  private tick(): void {
    const frame = this.threeRenderer.renderer.xr.getFrame();
    if (!frame || !this.hitTestSource || !this.referenceSpace) return;

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(this.referenceSpace);
      if (pose) {
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        this.reticle.visible = true;
        this.reticle.matrix.copy(m);
        this.reticle.matrixAutoUpdate = false;

        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        m.decompose(pos, rot, scl);
        this.onHitTest?.({ position: pos, rotation: rot });
      }
    } else {
      this.reticle.visible = false;
      this.onHitTest?.(null);
    }
  }

  private onSessionEnd(): void {
    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.xrSession = null;
    this.reticle.visible = false;
    this.threeRenderer.stop();
  }
}
