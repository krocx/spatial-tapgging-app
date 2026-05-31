// Author Mode — create and train the pass state for a tag.
//
// Flow:
//   1. QR scan → get { assetId, anchorId }
//   2. Open session in SIB
//   3. Tap to place tag (hit-test or camera fallback)
//   4. Honeycomb capture sphere appears around tag
//   5. Move camera to each node — auto-capture when aligned
//   6. POST /perception/train with all images
//   7. Done — show success

import * as THREE from 'three';
import type { QRAnchorContext, PassStateImage, CameraPose } from '@spatial/shared';
import { ThreeRenderer } from '../renderer/three-renderer.js';
import { HoneycombSphere } from '../visualizations/honeycomb-sphere.js';
import { PlacementReticle } from '../visualizations/placement-reticle.js';
import { TagMarker } from '../visualizations/tag-marker.js';
import { TagDirectionArrow } from '../ui/tag-direction-arrow.js';
import { ImageCapture } from '../capture/image-capture.js';
import { DeviceOrientationEngine } from '../engines/device-orientation-engine.js';
import { createSession, createTag, submitPassState, createAnchor } from '../api/sib-client.js';

const ASSET_ID_FALLBACK = import.meta.env.VITE_ASSET_ID ?? 'asset-001';
const USER_ID           = import.meta.env.VITE_USER_ID  ?? 'user-001';

export interface AuthorModeCallbacks {
  onStatus: (msg: string) => void;
  onComplete: () => void;
  onError: (err: string) => void;
}

export class AuthorMode {
  private honeycomb: HoneycombSphere | null = null;
  private reticle: PlacementReticle | null = null;
  private tagMarker: TagMarker | null = null;
  private dirArrow: TagDirectionArrow | null = null;
  private capturedImages: PassStateImage[] = [];
  private active = false;
  private alignTimer = 0;   // accumulates delta for honeycomb animations
  private dwellStart = -1;  // performance.now() when dwell began, -1 if not dwelling

  constructor(
    private readonly renderer: ThreeRenderer,
    private readonly video: HTMLVideoElement,
    private readonly cb: AuthorModeCallbacks,
    // Passed in from main.ts where it was started inside the tap handler
    private readonly orientationEngine: DeviceOrientationEngine | null = null,
  ) {}

  async start(qrContext: QRAnchorContext): Promise<void> {
    this.active = true;
    const { assetId, anchorId } = qrContext;

    // Capture the camera quaternion at QR-scan time so we can store
    // tag positions relative to the QR frame.
    const qrScanQ = qrContext.scanQuaternion
      ? new THREE.Quaternion(
          qrContext.scanQuaternion.x,
          qrContext.scanQuaternion.y,
          qrContext.scanQuaternion.z,
          qrContext.scanQuaternion.w,
        )
      : this.renderer.camera.quaternion.clone();

    this.cb.onStatus('Opening session…');

    const session = await createSession({ userId: USER_ID, assetId });

    // ── Show placement reticle ───────────────────────────────────────────────
    this.reticle = new PlacementReticle(this.renderer.scene);
    this.renderer.onUpdate((delta) => {
      if (this.reticle) this.reticle.update(this.renderer.camera, delta);
    });
    this.renderer.start();

    this.cb.onStatus('Aim at a surface and tap "Place Tag" to confirm placement');

    // Wait for explicit Place Tag button press
    const tagPosition = await this.waitForPlaceTag();
    if (!this.active) return;

    // Hide reticle + Place Tag button now that placement is confirmed
    this.reticle.setVisible(false);
    const placeTagBtn = document.getElementById('btn-place-tag');
    if (placeTagBtn) placeTagBtn.style.display = 'none';

    // Create (or re-use) an anchor whose SIB id == the QR's anchorId.
    // This means Operator mode can call GET /tags?anchorId=<qr-anchorId> and
    // always find the tag, regardless of page reloads.
    // The SIB anchor route returns the existing record if the id already exists.
    const anchor = await createAnchor({
      // Pass id so the SIB uses the QR's anchorId instead of generating a UUID.
      // (The SIB POST /anchors handler accepts an optional `id` field.)
      ...(anchorId ? { id: anchorId } : {}),
      assetId,
      coordinateSystem: 'LOCAL_DEVICE_FRAME',
      position: { x: tagPosition.x, y: tagPosition.y, z: tagPosition.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      metadata: {},
    } as Parameters<typeof createAnchor>[0]);

    // Compute QR-relative rotation: how the camera rotated from the QR-scan
    // moment to the tag-placement moment.  Operator mode uses this to
    // reconstruct the tag's world position relative to its own QR scan.
    const tagPlacementQ = this.renderer.camera.quaternion.clone();
    const relQ = qrScanQ.clone().invert().multiply(tagPlacementQ);
    // Distance from camera origin to tag (roughly the reticle depth, ~1.5 m)
    const tagDistance = tagPosition.length();

    const tag = await createTag({
      anchorId: anchor.id,
      type: 'INSPECTION_POINT',
      label: `Tag-${Date.now()}`,
      expectedOutcome: 'Pass state trained',
      metadata: {
        sessionId: session.id,
        authorId:  USER_ID,
        // QR-relative pose — used by Operator mode to place the spatial guide
        qrRelativeRotation: { x: relQ.x, y: relQ.y, z: relQ.z, w: relQ.w },
        tagDistance:        tagDistance,
      },
    });

    // ── Sticky-note tag marker ───────────────────────────────────────────────
    const shortId = tag.id.slice(0, 8).toUpperCase();
    this.tagMarker = new TagMarker(
      this.renderer.scene,
      tagPosition,
      tag.label,
      shortId,
      this.renderer.camera,   // orient card to face camera at placement time
    );
    // Off-screen direction arrow
    const arrowEl = document.getElementById('tag-arrow');
    if (arrowEl) this.dirArrow = new TagDirectionArrow(arrowEl);

    this.renderer.onUpdate((delta) => {
      if (this.tagMarker) {
        this.tagMarker.update(this.renderer.camera, delta);
        // Update off-screen arrow
        if (this.dirArrow) {
          const sp = this.tagMarker.getScreenPosition(
            this.renderer.camera, window.innerWidth, window.innerHeight,
          );
          this.dirArrow.update(sp, window.innerWidth, window.innerHeight);
        }
      }
    });

    // ── Honeycomb capture sphere ─────────────────────────────────────────────
    this.honeycomb = new HoneycombSphere(this.renderer.scene, tagPosition);
    // renderer.start() was already called when reticle was shown

    this.cb.onStatus(
      `Move around the tag — ${this.honeycomb.totalCount()} captures needed (0 done)`,
    );

    // Start per-frame alignment check
    const capture = new ImageCapture(
      this.renderer.renderer.domElement,
      this.video,
    );
    this.startAlignmentLoop(capture, tag.id, anchor.id, assetId, session.id);
  }

  stop(): void {
    this.active = false;
    this.reticle?.dispose();
    this.reticle = null;
    this.tagMarker?.dispose();
    this.tagMarker = null;
    this.dirArrow?.hide();
    this.dirArrow = null;
    this.honeycomb?.dispose();
    this.honeycomb = null;
    this.capturedImages = [];
  }

  // ── Alignment loop ──────────────────────────────────────────────────────────
  // Runs inside renderer.onUpdate so it stays in sync with camera pose updates.
  // Uses screen-space alignment: the node ring must appear near the crosshair.

  private DWELL_MS = 500;  // ms the crosshair must stay on a node before capture

  private startAlignmentLoop(
    capture: ImageCapture,
    tagId: string,
    anchorId: string,
    assetId: string,
    sessionId: string,
  ): void {
    this.renderer.onUpdate((delta) => {
      if (!this.active || !this.honeycomb) return;

      this.alignTimer += delta;

      // Screen dimensions in CSS pixels (consistent with device pixel events)
      const W = window.innerWidth;
      const H = window.innerHeight;

      // Update billboard orientation + node visuals
      this.honeycomb.update(this.renderer.camera, this.alignTimer);

      // Check screen-space alignment (sets internal alignedIndex for visuals)
      const aligned = this.honeycomb.getAlignedNodeScreenSpace(
        this.renderer.camera, W, H,
      );

      if (aligned) {
        // Started dwelling on a node
        if (this.dwellStart < 0) this.dwellStart = performance.now();

        const held     = performance.now() - this.dwellStart;
        const progress = Math.min(1, held / this.DWELL_MS);
        this.honeycomb.setDwellProgress(progress);

        if (progress >= 1) {
          // ── Capture! ──────────────────────────────────────────────────────
          this.dwellStart = -1;

          const frame = capture.capture(0.8);
          const pose  = this.getCameraPose();

          const img: PassStateImage = {
            id:          crypto.randomUUID(),
            tagId,
            anchorId,
            assetId,
            imageBase64: frame.imageBase64,
            mimeType:    'image/jpeg',
            pose,
            capturedAt:  new Date().toISOString(),
          };

          this.capturedImages.push(img);
          this.honeycomb.markCaptured(aligned.index);

          const done  = this.honeycomb.capturedCount();
          const total = this.honeycomb.totalCount();

          if (this.honeycomb.isComplete()) {
            this.cb.onStatus(`✓ All ${total} angles captured — submitting…`);
            this.submitTraining(tagId, anchorId, assetId, sessionId);
          } else {
            this.cb.onStatus(`✓ ${done}/${total} captured — aim at next glowing ring`);
          }

        } else {
          // Show dwell progress in status bar
          const pct = Math.round(progress * 100);
          this.cb.onStatus(`Hold steady… ${pct}%`);
        }

      } else {
        // No alignment — reset dwell
        this.dwellStart = -1;
        this.honeycomb.setDwellProgress(0);

        // Guide message only when not mid-capture
        if (!this.honeycomb.isComplete()) {
          const done  = this.honeycomb.capturedCount();
          const total = this.honeycomb.totalCount();
          this.cb.onStatus(
            `Aim crosshair at the glowing cyan ring — ${done}/${total} captured`,
          );
        }
      }
    });
  }

  private async submitTraining(
    tagId: string,
    anchorId: string,
    assetId: string,
    sessionId: string,
  ): Promise<void> {
    this.cb.onStatus('Submitting pass state to SIB…');
    try {
      await submitPassState({
        tagId,
        anchorId,
        assetId,
        images: this.capturedImages,
      });
      this.cb.onStatus('✓ Pass state trained! Tag is ready for Operator validation.');
      this.cb.onComplete();
    } catch (err) {
      this.cb.onError(`Training failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private waitForPlaceTag(): Promise<THREE.Vector3> {
    return new Promise(resolve => {
      const btn = document.getElementById('btn-place-tag');
      const handler = () => {
        // Use the reticle's current world position — where the user was aiming.
        // Falls back to 1.5 m directly ahead if the reticle wasn't ready yet.
        const pos = this.reticle
          ? this.reticle.getPosition()
          : new THREE.Vector3(0, 0, -1.5);
        resolve(pos);
      };
      if (btn) {
        btn.addEventListener('click', handler, { once: true });
      } else {
        // Fallback: any tap/click if the button isn't found in the DOM
        document.addEventListener('click', handler, { once: true });
      }
    });
  }

  private getCameraPose(): CameraPose {
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    this.renderer.camera.getWorldPosition(pos);
    this.renderer.camera.getWorldQuaternion(rot);
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    };
  }
}
