// Anchor Creation Flow
// Converts a Three.js world position (from WebXR hit-test or AR.js marker root)
// into a SIB Anchor via the SIB API.
//
// Keeps all SIB API calls here — never in the AR engines.

import * as THREE from 'three';
import { createAnchor } from '../api/sib-client.js';
import type { Anchor } from '@spatial/shared';

export interface AnchorCreationParams {
  assetId: string;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  metadata?: Record<string, unknown>;
}

export class AnchorCreationFlow {
  // Converts a Three.js pose into a SIB Anchor.
  // Coordinate system is LOCAL_DEVICE_FRAME in Phase 1.
  // Phase 2: transform to ASSET_FRAME using SIB transform API.
  async createFromPose(params: AnchorCreationParams): Promise<Anchor> {
    const anchor = await createAnchor({
      assetId: params.assetId,
      coordinateSystem: 'LOCAL_DEVICE_FRAME',
      position: {
        x: params.position.x,
        y: params.position.y,
        z: params.position.z,
      },
      rotation: {
        x: params.rotation.x,
        y: params.rotation.y,
        z: params.rotation.z,
        w: params.rotation.w,
      },
      metadata: params.metadata ?? {},
    });

    console.debug('[AnchorCreation] created anchor', anchor.id, 'for asset', params.assetId);
    return anchor;
  }
}
