# Spatial Tagging App (Hybrid Browser AR Client) + SIB v0.1

## 1. Overview
This project implements Phase 1 of our Spatial Intelligence vision:

- A **Hybrid Browser AR Client** for spatial tagging  
- A **Spatial Intelligence Backend (SIB v0.1)** for anchors, tags, sessions, and basic perception

This is the first real client of SIB and the foundation for future AR glasses and robotics integrations.

## 2. Structure
- `/ar-client` — Hybrid AR client (WebXR + AR.js + Three.js)
- `/sib` — Backend logic (anchors, tags, sessions, perception adapters)
- `/docs` — Architecture, schemas, and conceptual references
- `/skills` — Claude Cowork guidelines and coding standards

## 3. How to use Claude Cowork
When starting a Cowork session:

1. Read:
   - `README.md`
   - `/docs/sib-overview.md`
   - `/docs/ar-client-overview.md`
   - `/docs/schemas.md`
   - `/skills/cowork-guidelines.md`

2. Follow the architecture strictly.
3. Keep AR client thin; keep logic in SIB.
4. Maintain multi-file consistency.

## 4. Phase 1 Deliverables ✓ COMPLETE
- WebXR engine
- AR.js engine
- Three.js renderer
- Tag placement flow
- Anchor creation
- Image capture
- SIB integration (anchors, tags, sessions, pass-states, SSIM validation)

## 5. Phase 2 Deliverables (Active)
See `/docs/phase2-architecture.md` for full spec.

- Native iOS app (Swift + ARKit + SwiftUI)
- ARKit image tracking on QR codes (reliable real-world anchor)
- Multi-tag per anchor (N independent inspection checks per location)
- Author mode: create + train multiple tags at one QR location
- Operator mode: scan once → get per-tag PASS/FAIL for all checks
- SIB v0.2: batch validation endpoint, AnchorValidationResult schema
- Macbook as SIB server host on local LAN

## 6. Ownership
Vision & architecture: Karthik  
Implementation: Engineering + Claude Cowork
