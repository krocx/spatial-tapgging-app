// SpatialGuide — dashed gold lines from the estimated QR position to each tag.
//
// Draws in the Three.js scene so operators get a spatial breadcrumb pointing
// toward each tag from the QR code origin.
//
// Usage:
//   const guide = new SpatialGuide(scene, qrWorldPos, tagWorldPositions, tagLabels);
//   guide.dispose(); // when done

import * as THREE from 'three';

const LINE_COLOR  = 0xffd700;  // gold
const DOT_COLOR   = 0xffd700;
const DASH_SIZE   = 0.06;
const GAP_SIZE    = 0.035;

export class SpatialGuide {
  private readonly objects: THREE.Object3D[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    qrWorldPos: THREE.Vector3,
    tagPositions: THREE.Vector3[],
    _tagLabels: string[] = [],
  ) {
    // QR origin marker — small bright sphere
    const qrDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffaa }),
    );
    qrDot.position.copy(qrWorldPos);
    scene.add(qrDot);
    this.objects.push(qrDot);

    // One dashed line + end dot per tag
    for (let i = 0; i < tagPositions.length; i++) {
      const tagPos = tagPositions[i];

      // Dashed line QR → tag
      const geo = new THREE.BufferGeometry().setFromPoints([qrWorldPos, tagPos]);
      const mat = new THREE.LineDashedMaterial({
        color:       LINE_COLOR,
        dashSize:    DASH_SIZE,
        gapSize:     GAP_SIZE,
        transparent: true,
        opacity:     0.85,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      scene.add(line);
      this.objects.push(line);

      // Small dot at tag end of the line
      const endDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 8, 6),
        new THREE.MeshBasicMaterial({ color: DOT_COLOR }),
      );
      endDot.position.copy(tagPos);
      scene.add(endDot);
      this.objects.push(endDot);
    }
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      if ((obj as THREE.Mesh).material) {
        ((obj as THREE.Mesh).material as THREE.Material).dispose();
      }
    }
    this.objects.length = 0;
  }
}
