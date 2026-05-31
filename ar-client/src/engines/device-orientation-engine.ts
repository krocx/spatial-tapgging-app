// DeviceOrientationEngine
// Reads alpha/beta/gamma from the DeviceOrientation API and applies them to
// the Three.js camera so it follows real device rotation in camera-fallback mode.
//
// On iOS 13+ this requires a user-gesture permission request.
// Call requestPermission() once (on a button tap), then start().

import * as THREE from 'three';

const Q_SCREEN = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° X

export class DeviceOrientationEngine {
  private alpha  = 0;
  private beta   = 0;
  private gamma  = 0;
  private bound: ((e: DeviceOrientationEvent) => void) | null = null;
  private running = false;

  constructor(private readonly camera: THREE.Camera) {}

  // Call this inside a user-gesture handler (button tap).
  // Returns true if permission was granted (or not needed on Android).
  static async requestPermission(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DOE = DeviceOrientationEvent as any;
    if (typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      return res === 'granted';
    }
    // Android / desktop — no permission needed
    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.bound = (e: DeviceOrientationEvent) => {
      this.alpha = e.alpha ?? 0;
      this.beta  = e.beta  ?? 0;
      this.gamma = e.gamma ?? 0;
    };
    window.addEventListener('deviceorientation', this.bound);
  }

  stop(): void {
    this.running = false;
    if (this.bound) {
      window.removeEventListener('deviceorientation', this.bound);
      this.bound = null;
    }
  }

  // Call this every frame (from ThreeRenderer.onUpdate) to apply orientation.
  update(): void {
    if (!this.running) return;

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(this.beta),
      THREE.MathUtils.degToRad(this.alpha),
      -THREE.MathUtils.degToRad(this.gamma),
      'YXZ',
    );

    const q = new THREE.Quaternion().setFromEuler(euler);
    q.multiply(Q_SCREEN);
    this.camera.quaternion.copy(q);
  }
}
