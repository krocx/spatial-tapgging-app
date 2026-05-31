// Three.js scene + renderer — shared by both WebXR and AR.js engines.
// Owns the WebGLRenderer, scene graph, camera, and render loop.
// AR engines attach their camera/pose updates here; never touch the DOM directly.

import * as THREE from 'three';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
}

export class ThreeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private animationId: number | null = null;
  private updateCallbacks: Array<(delta: number) => void> = [];
  private clock = new THREE.Clock();

  constructor({ canvas, antialias = true }: RendererOptions) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      alpha: true,       // transparent background so camera feed shows through
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true; // enable WebXR on renderer

    // Scene
    this.scene = new THREE.Scene();

    // Default ambient + directional light — enough for tag indicators
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(0, 10, 5);
    this.scene.add(ambient, directional);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      65,                                        // matches iPhone rear camera FOV
      window.innerWidth / window.innerHeight,
      0.01,
      1000,
    );
    this.scene.add(this.camera);

    // Resize handler
    window.addEventListener('resize', this.onResize.bind(this));
  }

  // Register a per-frame callback (used by AR engines for pose updates)
  onUpdate(cb: (delta: number) => void): void {
    this.updateCallbacks.push(cb);
  }

  start(): void {
    if (this.animationId !== null) return;
    this.renderer.setAnimationLoop(this.tick.bind(this));
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
    this.animationId = null;
  }

  // Add a 3D object to the scene
  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize.bind(this));
  }

  private tick(): void {
    const delta = this.clock.getDelta();
    for (const cb of this.updateCallbacks) {
      cb(delta);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
