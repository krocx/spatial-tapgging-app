# AR OJT — real-time part tracking and CAD-driven guidance

Branch `feature/ar-ojt`. The on-the-job-training mode for **parts that move**:
a base part (first POC: Etch cathode down plate; design is equipment-agnostic)
that technicians rotate, slide and flip on a bench while installing components.

| Doc | What |
|---|---|
| [PART-FRAME.md](PART-FRAME.md) | The tracker: LiDAR primitive fit, yaw from features, edge-based 6-DoF refinement (assembly-state-aware), fusion, freeze/follow, flip |
| [CAD-CONTENT.md](CAD-CONTENT.md) | Steps as CAD node sets; registration = PartFrame; rendered/geometric validation references |
| [HOME-TEST-RIG.md](HOME-TEST-RIG.md) | 1:1 proxy rig, test scripts S1–S9, synthetic tests; cleanroom = confirmation only |
| [CORTONA3D-IMPORT.md](CORTONA3D-IMPORT.md) | Importing RapidManual procedures: recon script → importer → validation |
| [PLAN.md](PLAN.md) | Build order, acceptance, daily loop |
| [DECISIONS.md](DECISIONS.md) | ADRs |

Own code on Apple SDKs only (ARKit, Vision, Core ML, Metal, Accelerate).
