// Tag Placement Flow
// Orchestrates: anchor creation → tag creation → 3D indicator placement in scene.
//
// This is the core Phase 1 user interaction loop:
//   1. User taps "Place Tag" while a surface is detected
//   2. Flow creates an Anchor at the hit position
//   3. Flow creates a Tag attached to that Anchor
//   4. Flow adds a visible 3D sphere to the Three.js scene at that position

import * as THREE from 'three';
import type { ThreeRenderer } from '../renderer/three-renderer.js';
import { AnchorCreationFlow } from './anchor-creation.js';
import { createTag } from '../api/sib-client.js';
import type { Anchor, Tag, TagType } from '@spatial/shared';

export interface TagPlacementOptions {
  assetId: string;
  sessionId: string;
  userId: string;
  tagType?: TagType;
  label?: string;
  expectedOutcome?: string;
}

export interface PlacedTag {
  anchor: Anchor;
  tag: Tag;
  indicator: THREE.Mesh; // the 3D object in the scene
}

export class TagPlacementFlow {
  private anchorFlow = new AnchorCreationFlow();
  private placedTags: PlacedTag[] = [];

  // Tag indicator geometry — shared across all placed tags for memory efficiency
  private static readonly INDICATOR_GEO = new THREE.SphereGeometry(0.04, 16, 12);
  private static readonly INDICATOR_MAT = new THREE.MeshStandardMaterial({
    color: 0x00aaff,
    emissive: 0x003366,
    roughness: 0.4,
    metalness: 0.2,
  });

  constructor(private readonly threeRenderer: ThreeRenderer) {}

  // Call this when the user taps "Place Tag".
  // position / rotation come from WebXREngine.getCurrentHitPosition() or AR.js markerRoot.
  async placeTag(
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    options: TagPlacementOptions,
  ): Promise<PlacedTag> {
    // 1. Create SIB anchor
    const anchor = await this.anchorFlow.createFromPose({
      assetId: options.assetId,
      position,
      rotation,
      metadata: { sessionId: options.sessionId, userId: options.userId },
    });

    // 2. Create SIB tag
    const tag = await createTag({
      anchorId: anchor.id,
      type: options.tagType ?? 'INSPECTION_POINT',
      label: options.label ?? `Tag-${this.placedTags.length + 1}`,
      expectedOutcome: options.expectedOutcome ?? '',
      metadata: { sessionId: options.sessionId },
    });

    // 3. Add 3D indicator to Three.js scene
    const indicator = new THREE.Mesh(
      TagPlacementFlow.INDICATOR_GEO,
      TagPlacementFlow.INDICATOR_MAT.clone(), // clone so each tag can have its own color later
    );
    indicator.position.copy(position);
    indicator.quaternion.copy(rotation);
    indicator.userData = { anchorId: anchor.id, tagId: tag.id };
    this.threeRenderer.add(indicator);

    const placed: PlacedTag = { anchor, tag, indicator };
    this.placedTags.push(placed);

    console.debug('[TagPlacement] placed tag', tag.id, 'at', position);
    return placed;
  }

  // Remove all placed tags from the scene and clear the local list.
  reset(): void {
    for (const { indicator } of this.placedTags) {
      this.threeRenderer.remove(indicator);
    }
    this.placedTags = [];
  }

  getPlacedTags(): PlacedTag[] {
    return [...this.placedTags];
  }
}
