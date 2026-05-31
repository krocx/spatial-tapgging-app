// Operator Mode — validate a tag's current state against its trained pass state.
//
// Flow:
//   1. QR scan → get { assetId, anchorId }
//   2. Load tag + pass state from SIB
//   3. Show tag location overlay
//   4. Operator moves camera into position
//   5. Tap Capture → POST /perception/validate
//   6. Show PASS (green) or FAIL (red) overlay

import * as THREE from 'three';
import type { QRAnchorContext, Tag, PassState } from '@spatial/shared';
import { ThreeRenderer } from '../renderer/three-renderer.js';
import { ImageCapture } from '../capture/image-capture.js';
import { TagMarker } from '../visualizations/tag-marker.js';
import { TagDirectionArrow } from '../ui/tag-direction-arrow.js';
import { SpatialGuide } from '../visualizations/spatial-guide.js';
import {
  createSession,
  getTagsByAnchor,
  getPassState,
  validateTag,
} from '../api/sib-client.js';

const USER_ID = import.meta.env.VITE_USER_ID ?? 'user-001';

export interface OperatorModeCallbacks {
  onStatus: (msg: string) => void;
  onResult: (status: 'PASS' | 'FAIL', confidence: number) => void;
  onError:  (msg: string) => void;
}

export class OperatorMode {
  private tagIndicator: THREE.Mesh | null = null;
  private tagMarker: TagMarker | null = null;
  private dirArrow: TagDirectionArrow | null = null;
  private spatialGuide: SpatialGuide | null = null;
  private active = false;

  constructor(
    private readonly renderer: ThreeRenderer,
    private readonly video: HTMLVideoElement,
    private readonly captureBtn: HTMLButtonElement,
    private readonly cb: OperatorModeCallbacks,
  ) {}

  async start(qrContext: QRAnchorContext): Promise<void> {
    this.active = true;
    const { assetId, anchorId } = qrContext;

    // Camera quaternion at the moment the operator scanned the QR code.
    const opScanQ = qrContext.scanQuaternion
      ? new THREE.Quaternion(
          qrContext.scanQuaternion.x,
          qrContext.scanQuaternion.y,
          qrContext.scanQuaternion.z,
          qrContext.scanQuaternion.w,
        )
      : this.renderer.camera.quaternion.clone();

    this.cb.onStatus('Loading tag data…');

    // Load ALL tags for this anchor + the pass state for the primary one
    let allTags: Tag[];
    let tag: Tag;
    let passState: PassState;
    try {
      allTags = await getTagsByAnchor(anchorId);
      if (allTags.length === 0) {
        throw new Error(
          `No tag found for anchor "${anchorId}". ` +
          `Make sure Author mode has been run for this QR code.`,
        );
      }
      // Sort newest-first; primary tag for validation is the most recent one.
      allTags.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      tag = allTags[0];
      passState = await getPassState(tag.id);
    } catch (err) {
      this.cb.onError(err instanceof Error ? err.message : String(err));
      return;
    }

    const session = await createSession({ userId: USER_ID, assetId });

    // ── Reconstruct world positions ──────────────────────────────────────────
    // Each tag stores the QR-relative rotation at placement time.
    // We apply the operator's QR-scan quaternion on top to get a world-space
    // direction, then scale by tagDistance to get the 3-D position.

    /** Estimate world position for one tag using the operator's QR orientation */
    const reconstructTagPos = (t: Tag): THREE.Vector3 => {
      const meta = t.metadata as Record<string, unknown>;
      const relMeta = meta.qrRelativeRotation as
        { x: number; y: number; z: number; w: number } | undefined;
      const dist = typeof meta.tagDistance === 'number' ? meta.tagDistance : 1.5;

      if (!relMeta) {
        // Legacy tag — no stored relative rotation.
        // Place straight ahead of the operator's camera at QR-scan time
        // (same direction as the QR code, just a bit further out).
        return new THREE.Vector3(0, 0, -1).applyQuaternion(opScanQ).multiplyScalar(dist);
      }

      const relQ = new THREE.Quaternion(relMeta.x, relMeta.y, relMeta.z, relMeta.w);
      // Compose: operator QR orientation × author's QR→tag relative rotation
      const tagQ = opScanQ.clone().multiply(relQ);
      return new THREE.Vector3(0, 0, -1).applyQuaternion(tagQ).multiplyScalar(dist);
    };

    const tagPos = reconstructTagPos(tag);

    // Estimated QR-code world position (0.8 m directly ahead during scan)
    const qrPos = new THREE.Vector3(0, 0, -1).applyQuaternion(opScanQ).multiplyScalar(0.8);

    // All tag positions (for spatial guide)
    const allTagPositions = allTags.map(t => reconstructTagPos(t));
    const allTagLabels    = allTags.map(t => t.label);

    // ── Scene objects ────────────────────────────────────────────────────────
    this.tagMarker = new TagMarker(
      this.renderer.scene,
      tagPos,
      tag.label,
      tag.id.slice(0, 8).toUpperCase(),
      this.renderer.camera,
    );
    this.showTagIndicator(tagPos);

    // Spatial guide: dashed gold lines QR → each tag
    this.spatialGuide = new SpatialGuide(
      this.renderer.scene,
      qrPos,
      allTagPositions,
      allTagLabels,
    );

    this.renderer.start();
    const arrowEl = document.getElementById('tag-arrow');
    if (arrowEl) this.dirArrow = new TagDirectionArrow(arrowEl);
    this.renderer.onUpdate((delta) => {
      if (this.tagMarker) {
        this.tagMarker.update(this.renderer.camera, delta);
        if (this.dirArrow) {
          const sp = this.tagMarker.getScreenPosition(
            this.renderer.camera, window.innerWidth, window.innerHeight,
          );
          this.dirArrow.update(sp, window.innerWidth, window.innerHeight);
        }
      }
    });

    this.cb.onStatus(
      `Tag "${tag.label}" loaded — ${passState.images.length} reference images. ` +
      `Follow the gold guide lines then tap Capture.`,
    );

    // Wire capture button
    const capture = new ImageCapture(this.renderer.renderer.domElement, this.video);
    const handler = async () => {
      if (!this.active) return;
      this.cb.onStatus('Evaluating…');

      try {
        const frame = capture.capture(0.85);
        const result = await validateTag({
          tagId:       tag.id,
          anchorId:    anchorId,
          assetId,
          sessionId:   session.id,
          imageBase64: frame.imageBase64,
          mimeType:    'image/jpeg',
        });

        this.cb.onResult(result.status as 'PASS' | 'FAIL', result.confidence);
        this.updateIndicatorColor(result.status === 'PASS' ? 0x00dd66 : 0xff3333);
        this.cb.onStatus(
          result.status === 'PASS'
            ? `✓ PASS — confidence ${(result.confidence * 100).toFixed(0)}%`
            : `✗ FAIL — confidence ${(result.confidence * 100).toFixed(0)}%`,
        );
      } catch (err) {
        this.cb.onError(`Validation error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    this.captureBtn.addEventListener('click', handler);

    // Store handler for cleanup
    (this as any)._captureHandler = handler;
  }

  stop(): void {
    this.active = false;
    this.tagMarker?.dispose();
    this.tagMarker = null;
    this.dirArrow?.hide();
    this.dirArrow = null;
    this.spatialGuide?.dispose();
    this.spatialGuide = null;
    if (this.tagIndicator) {
      this.renderer.scene.remove(this.tagIndicator);
      this.tagIndicator = null;
    }
    if ((this as any)._captureHandler) {
      this.captureBtn.removeEventListener('click', (this as any)._captureHandler);
    }
  }

  private showTagIndicator(position: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.04, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      emissive: 0x003366,
      transparent: true,
      opacity: 0.85,
    });
    this.tagIndicator = new THREE.Mesh(geo, mat);
    this.tagIndicator.position.copy(position);
    this.renderer.scene.add(this.tagIndicator);

    // Pulse animation via onUpdate
    let t = 0;
    this.renderer.onUpdate(delta => {
      t += delta;
      if (this.tagIndicator) {
        const scale = 1 + 0.15 * Math.sin(t * 3);
        this.tagIndicator.scale.setScalar(scale);
      }
    });
  }

  private updateIndicatorColor(hex: number): void {
    if (!this.tagIndicator) return;
    const mat = this.tagIndicator.material as THREE.MeshStandardMaterial;
    mat.color.setHex(hex);
    mat.emissive.setHex(hex);
  }
}
