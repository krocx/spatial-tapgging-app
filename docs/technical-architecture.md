---

# 📄 **`technical-architecture.md`**  
### *Spatial Intelligence Backend (SIB): Technical Architecture v1.0*

---

# **1. Purpose of SIB**

The Spatial Intelligence Backend (SIB) is the **core brain** of our contextual intelligence platform.  
It provides:

- A **unified spatial model** (anchors, coordinate systems, transforms)  
- A **semantic model** (tags, procedures, defect ontology)  
- A **perception orchestration layer** for multi‑model AI  
- A **session + evidence store** for technicians, wearables, and cobots  
- A **device‑agnostic API** for browser AR, Unity AR, and robotics  

SIB is designed to be **future‑proof**, **model‑agnostic**, and **client‑agnostic**.

---

# **2. High‑Level Architecture**

## **2.1 Layers**
1. **Spatial Layer**  
2. **Semantic Layer**  
3. **Perception Layer**  
4. **Orchestration Layer**  
5. **Session Layer**  
6. **Client Layer (replaceable)**  

## **2.2 Core Idea**  
SIB is the **source of truth** for:

- Anchors  
- Tags  
- Procedures  
- Observations  
- Sessions  
- Asset coordinate systems  

Clients (browser AR, Unity, robots) are **replaceable**.

---

# **3. Spatial Layer**

## **3.1 Anchors**
Anchors represent **stable spatial reference points** relative to an asset or environment.

## **3.2 Coordinate Systems**
Support multiple frames:

- `PLANT_FRAME`  
- `ASSET_FRAME`  
- `LOCAL_DEVICE_FRAME`  

Clients map their runtime anchors → SIB anchors.

## **3.3 Transforms**
Store transforms between coordinate systems (similar to ROS TF tree).

---

# **4. Semantic Layer**

## **4.1 Tags**
Tags represent:

- Inspection points  
- Defects  
- Instructions  
- Warnings  
- Measurements  

## **4.2 Procedures**
Procedures are **graphs** of tags with conditions.

## **4.3 Ontology**
Define a unified defect taxonomy:

- `DEFECT_TYPE_SCRATCH`  
- `DEFECT_TYPE_DENT`  
- `DEFECT_TYPE_BURN_MARK`  
- `STATUS_OK`  
- `STATUS_NG`  

Adapters map raw model labels → ontology.

---

# **5. Perception Layer**

## **5.1 Model‑Agnostic Observations**
All AI models output the same schema.

## **5.2 Perception Adapters**
Adapters convert raw model output → unified `Observation`.

Examples:

- Sodavision adapter  
- Neurocle adapter  
- Python classifier adapter  
- Foundation model adapter  

## **5.3 Orchestration**
SIB decides:

- Which models to call  
- How to merge results  
- How to resolve conflicts  
- How to store evidence  

---

# **6. Session Layer**

## **6.1 Sessions**
Sessions capture:

- Technician runs  
- Cobot runs  
- Observations  
- Completed steps  
- Images  
- Evidence  

## **6.2 Provenance**
Track:

- Which model produced what  
- Technician overrides  
- Model disagreements  

This enables retraining and continuous improvement.

---

# **7. Client Layer (Replaceable)**

## **7.1 Browser AR Client (Phase‑1)**
- Three.js  
- WebXR (Android)  
- AR.js (iOS Safari)  
- Thin client → calls SIB for everything  

## **7.2 Unity AR Client (Phase‑3)**
- ARKit/ARCore  
- RayNeo/AVP  
- Persistent anchors  
- Occlusion  
- High‑fidelity tracking  

## **7.3 Cobots / Automation**
- Use SIB anchors + tags  
- Use SIB observations  
- Use SIB procedures  

---

# **8. Future‑Proof Schemas (v1.0)**

Schemas are defined in `/docs/schemas.md` and include:

- Anchor  
- Tag  
- Observation  
- Procedure  
- Session  

These schemas are **canonical** and must be used by all clients and adapters.

---

# **9. Summary**

> **SIB is the technical foundation for contextual intelligence.  
It unifies spatial context, semantic meaning, and multi‑model perception.  
It enables browser AR today, Unity AR tomorrow, and autonomous systems in the future.  
It is model‑agnostic, device‑agnostic, and future‑proof.**
