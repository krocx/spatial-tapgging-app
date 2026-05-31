# Phase 2 Architecture — Multi-Tag Spatial Inspection
### Spatial Tagging App · iPhone (Native iOS) + Macbook (SIB Server)

---

## 1. What Changes from Phase 1

| Dimension | Phase 1 (Browser AR) | Phase 2 (Native iOS + SIB) |
|---|---|---|
| iPhone client | WebXR / AR.js in Safari | Native Swift + ARKit + SwiftUI |
| Anchor tracking | Device orientation + QR | ARKit image tracking on QR code |
| Tags per anchor | 1 (de-facto) | N — multiple independent checks |
| Validation result | Single PASS/FAIL | Per-tag PASS/FAIL + anchor summary |
| Detection engine | SSIM + histogram (single) | SSIM + histogram (per-tag, batched) |
| Macbook role | Development only | SIB server host on local network |
| Operator guidance | One score | Which specific checks failed — with label |

The core SIB backend stays in Node.js/TypeScript on the Macbook and continues to be the source of truth. The browser AR client is retired for cleanroom use; the native iOS app replaces it entirely.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────┐        WiFi / LAN
│         iPhone (iOS App)        │ ◄──────────────────► ┌──────────────────────┐
│                                 │                       │  Macbook (SIB v0.2)  │
│  ARKit         SwiftUI          │                       │                      │
│  ┌──────┐    ┌────────────┐     │  REST/JSON over HTTP  │  Node.js backend     │
│  │QR    │    │ Author UI  │     │ ──────────────────►   │  Anchors API         │
│  │Track │    │ Operator UI│     │ ◄──────────────────   │  Tags API            │
│  └──────┘    └────────────┘     │                       │  Training API        │
│                                 │                       │  Validation API      │
│  SIBClient (URLSession)         │                       │  Sessions API        │
│  PassStateCapture               │                       │                      │
│  MultiTagValidator              │                       │  .sib-data/ (JSON)   │
└─────────────────────────────────┘                       └──────────────────────┘
```

The Macbook runs `npm run dev` (or a packaged SIB server) and exposes the API on the local network (e.g., `http://192.168.1.x:3000`). Both devices must be on the same WiFi. The iPhone app has a one-time setup screen to enter the SIB base URL.

---

## 3. Anchor Reliability — The Real-World Anchor Problem

### Phase 1 problem
QR scanning in Safari via WebXR provided no 6DOF pose — only an identifier. Spatial position was approximated from device orientation, which drifted.

### Phase 2 solution: ARKit Image Tracking on QR Code

Each cleanroom QR code serves dual purpose:
1. **Identifier** — encodes `assetId` and `anchorId` as a JSON payload (existing)
2. **Physical marker** — registered as an `ARReferenceImage` so ARKit continuously tracks its 6DOF pose (position + orientation) in world space

**How it works:**
- QR codes are printed at known physical size (e.g., 10cm × 10cm) and affixed to equipment
- The app registers the QR image with ARKit's `ARImageTrackingConfiguration`
- ARKit returns an `ARImageAnchor` — the exact 3D pose of the QR in camera space
- All tag positions are stored relative to this QR anchor frame
- When operator returns days later: scan same QR → ARKit re-detects → all tag markers snap back to correct positions

**Why this is reliable:**
- ARKit's Vision-based image tracking works even if the device moves away and returns
- No world map, no drift, no need for SLAM initialization
- The QR IS the anchor — robust to cleanroom re-entry, app restarts, different devices
- Works under controlled cleanroom lighting

### QR Code Requirements (Production)
- Print at 10cm × 10cm minimum
- High contrast, matte finish (avoid glare)
- JSON payload: `{ "assetId": "eq-001", "anchorId": "panel-a" }`
- Each QR unique per inspection point

---

## 4. Multi-Tag Per Anchor — The Core Phase 2 Feature

### Concept

```
Anchor (= QR location)
  ├── Tag 1: "Warning Label — Present"        → PassState → PASS ✓
  ├── Tag 2: "Warning Label — Language EN"    → PassState → FAIL ✗  ← technician sees this
  ├── Tag 3: "Cable Routing — Left Panel"     → PassState → PASS ✓
  ├── Tag 4: "Gas Line A — Connected"         → PassState → PASS ✓
  └── Tag 5: "Gas Line B — Not Swapped"       → PassState → FAIL ✗  ← and this
```

The Operator arrives at one QR location and immediately sees which of the N checks at that location are passing and which are failing — without scanning multiple codes or running separate sessions.

### Tag Types for Cleanroom (extends Phase 1 ontology)

Add to `TagType` in `shared/src/index.ts`:

```typescript
export type TagType =
  | 'INSPECTION_POINT'
  | 'DEFECT'
  | 'INSTRUCTION'
  | 'WARNING'
  | 'MEASUREMENT'
  // Phase 2 additions
  | 'PRESENCE_CHECK'        // Is item X present?
  | 'LANGUAGE_CHECK'        // Is label language correct?
  | 'ROUTING_CHECK'         // Is cable/pipe routed correctly?
  | 'CONFIGURATION_CHECK'   // Is component in correct state/position?
  | 'PART_CHECK';           // Is part present and correct?
```

These are semantic labels only — they don't change the detection engine. All checks still use SSIM + histogram. The type helps the UI display the right icon and the report label the correct category.

---

## 5. Author Mode — Multi-Tag Training Flow

### User Journey

```
1. Open iOS app → select "Author Mode"
2. Point at QR code → ARKit detects → anchor locked (green border shows)
3. SIB creates/retrieves anchor for this QR
4. Tag list appears (empty on first visit)
5. Tap "+" → Add Tag dialog:
      Name:  [Warning Label - Present    ]
      Type:  [PRESENCE_CHECK ▼           ]
      Notes: [Check front face of panel  ]
   → Tap "Save Tag" → SIB creates tag
6. Tap tag → enter Training mode:
      - 3D honeycomb guide overlaid on camera
      - Move to each circle position
      - Auto-capture when aligned (or manual)
      - Captures N viewpoints (default 7)
   → Tap "Confirm Training" → SIB stores PassState
7. Repeat steps 5–6 for each check at this location
8. Summary screen: "5 tags trained at Panel A ✓"
```

### iOS Author Mode screens

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  [Camera View]  │    │  Add Tag        │    │  Train: Tag 1   │
│                 │    │                 │    │                 │
│  ┌── QR ──┐    │    │  Name: ______   │    │  [Camera + AR]  │
│  │Anchor  │    │    │  Type: [▼]      │    │  ○ ● ○ ○ ○     │
│  │Locked ✓│    │    │  Notes:_______  │    │  ○ ○ ○         │
│  └────────┘    │    │                 │    │                 │
│                 │    │  [Cancel][Save] │    │  3/7 captured   │
│  Tags (3):      │    └─────────────────┘    │  [Confirm]      │
│  ✓ Label Check  │                           └─────────────────┘
│  ✓ Language     │
│  ○ Gas Line A   │
│  [+ Add Tag]    │
└─────────────────┘
```

---

## 6. Operator Mode — Multi-Tag Validation Flow

### User Journey

```
1. Open iOS app → select "Operator Mode"
2. Point at QR code → ARKit detects anchor
3. SIB loads all tags for this anchor
4. All tags shown as PENDING
5. Tap "Scan All" (or auto-trigger on anchor lock)
6. Camera captures frame
7. Sent to SIB: POST /perception/validate-all
8. Results return per tag:
      ✓ Warning Label — Present     [PASS 0.87]
      ✗ Warning Label — Language    [FAIL 0.31] ← RED
      ✓ Cable Routing               [PASS 0.76]
      ✓ Gas Line A                  [PASS 0.82]
      ✗ Gas Line B — Not Swapped    [FAIL 0.29] ← RED
9. Anchor status: PARTIAL (some passed, some failed)
10. Technician addresses failing items → re-scan → confirm
11. Session records all ValidationResults
```

### Result States

| State | Meaning | Color |
|---|---|---|
| PENDING | Not yet scanned | Grey |
| PASS | Score ≥ threshold | Green |
| FAIL | Score < threshold | Red |
| PARTIAL | Some pass, some fail (anchor-level) | Amber |

### iOS Operator Mode — Result Overlay

```
┌─────────────────────────────────────┐
│  Panel A — Inspection Results       │
│  ─────────────────────────────────  │
│  ✓  Warning Label — Present   0.87  │
│  ✗  Warning Label — Language  0.31  │ ← tap for reference image
│  ✓  Cable Routing L-Panel     0.76  │
│  ✓  Gas Line A — Connected    0.82  │
│  ✗  Gas Line B — Swapped      0.29  │ ← tap for reference image
│                                     │
│  Status: PARTIAL (3/5 passed)       │
│                                     │
│  [Re-Scan]        [Record & Next]   │
└─────────────────────────────────────┘
```

Tapping a FAIL row shows the pass-state reference image alongside the live capture so the technician knows exactly what "correct" looks like.

---

## 7. SIB v0.2 — Backend Enhancements

### New Endpoint: Batch Validation

```
POST /perception/validate-all
```

**Request:**
```json
{
  "anchorId": "panel-a",
  "assetId":  "eq-001",
  "sessionId": "session-xyz",
  "imageBase64": "<jpeg base64>"
}
```

**Response:**
```json
{
  "data": {
    "anchorId": "panel-a",
    "assetId":  "eq-001",
    "sessionId": "session-xyz",
    "status": "PARTIAL",
    "passCount": 3,
    "failCount": 2,
    "totalCount": 5,
    "tagResults": [
      { "tagId": "t1", "tagLabel": "Warning Label — Present", "status": "PASS", "confidence": 0.87 },
      { "tagId": "t2", "tagLabel": "Warning Label — Language", "status": "FAIL", "confidence": 0.31 },
      ...
    ],
    "evaluatedAt": "2026-05-26T10:00:00Z"
  },
  "timestamp": "2026-05-26T10:00:00Z"
}
```

**Logic:** For each tag at the anchor that has a PassState, run `compareAgainstPassState` in parallel. Return individual results + aggregate status.

### New Schema Types (shared/src/index.ts)

```typescript
export type AnchorStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'PENDING';

export interface TagValidationSummary {
  tagId: string;
  tagLabel: string;
  tagType: TagType;
  status: ValidationStatus;
  confidence: number;
}

export interface AnchorValidationResult {
  id: string;
  anchorId: string;
  assetId: string;
  sessionId: string;
  status: AnchorStatus;
  passCount: number;
  failCount: number;
  totalCount: number;
  tagResults: TagValidationSummary[];
  evaluatedAt: string;
}

export interface BatchValidateRequest {
  anchorId: string;
  assetId: string;
  sessionId: string;
  imageBase64: string;
  mimeType: 'image/jpeg';
}
```

### Enhanced Tag Schema

Add `checkDescription` and `tagType` is already there. Add `order` for display sequencing:

```typescript
export interface Tag {
  id: string;
  anchorId: string;
  type: TagType;
  label: string;
  expectedOutcome: string;
  checkDescription?: string;  // NEW: human-readable guidance for operator
  order?: number;             // NEW: display order within anchor
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### SIB Server Configuration for LAN Access

The SIB must bind to `0.0.0.0` (not just `localhost`) so the iPhone can reach it:

```typescript
// sib/src/index.ts — change
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SIB] Listening on 0.0.0.0:${PORT}`);
});
```

---

## 8. iOS App — Technical Stack

| Component | Technology |
|---|---|
| Language | Swift 5.9+ |
| UI Framework | SwiftUI |
| AR tracking | ARKit 6 (iOS 16+) |
| QR detection | Vision framework (VNDetectBarcodesRequest) |
| Rendering | RealityKit (tag markers as AR entities) |
| Networking | URLSession + async/await |
| JSON | Codable structs mirroring SIB shared types |
| Image capture | AVFoundation (high-res JPEG) |
| Local config | UserDefaults (SIB URL, assetId) |

### Project Structure

```
SpatialTaggingApp/
├── App/
│   ├── SpatialTaggingApp.swift
│   └── AppSettings.swift          ← SIB URL, assetId storage
├── Models/
│   ├── SIBTypes.swift             ← Codable mirrors of shared/src/index.ts
│   └── AppState.swift
├── Services/
│   ├── SIBClient.swift            ← All REST calls
│   ├── QRScannerService.swift     ← Vision framework QR detection
│   └── PassStateCaptureService.swift ← Honeycomb capture logic
├── Modes/
│   ├── AuthorModeView.swift
│   ├── OperatorModeView.swift
│   └── ModeSelectionView.swift
├── Components/
│   ├── ARContainerView.swift      ← UIViewRepresentable wrapping ARView
│   ├── TagListView.swift
│   ├── ValidationResultRow.swift
│   ├── HoneycombGuideView.swift   ← Overlay for pass-state capture
│   └── AddTagSheet.swift
└── Assets/
    └── QRReferenceImages/         ← ARReferenceImage assets (optional)
```

---

## 9. Implementation Roadmap

### Phase 2A — Foundation (Week 1–2)
- [ ] iOS app skeleton: SwiftUI + ARKit setup
- [ ] QR scanning via Vision framework → decode JSON payload
- [ ] ARKit image tracking on QR (6DOF pose)
- [ ] SIBClient.swift: connect to Macbook SIB over LAN
- [ ] Settings screen: enter SIB base URL
- [ ] SIB: bind to 0.0.0.0, test from iPhone

### Phase 2B — Multi-Tag Author Mode (Week 3–4)
- [ ] Load/create anchor on QR scan
- [ ] Tag list screen: show all tags for anchor
- [ ] Add Tag sheet: name, type, description
- [ ] Per-tag honeycomb capture flow (port from Phase 1 logic)
- [ ] Submit PassState to SIB: POST /perception/train
- [ ] Visual confirmation: trained tag turns green

### Phase 2C — Multi-Tag Operator Mode (Week 5–6)
- [ ] Load all tags for anchor on QR scan
- [ ] New SIB endpoint: POST /perception/validate-all
- [ ] New SIB schema: AnchorValidationResult, BatchValidateRequest
- [ ] Operator result screen: per-tag PASS/FAIL list
- [ ] Tap-to-expand FAIL: show reference image vs live capture
- [ ] Re-scan button
- [ ] Session recording of AnchorValidationResult

### Phase 2D — Polish & Macbook Dashboard (Week 7–8)
- [ ] Macbook: simple web dashboard (existing browser client repurposed as admin UI)
- [ ] View all sessions and their anchor results
- [ ] Export session report (CSV or PDF)
- [ ] SIB: GET /sessions/:id/results — return full anchor result history
- [ ] iOS: offline queue — store captures locally if LAN drops, sync on reconnect

---

## 10. Key Design Decisions

### Why one image → all tags at an anchor?

Sending one image and running all N tag comparisons server-side is the right model because:
1. The technician doesn't need to change position between checks — all checks at a location are evaluated from the same vantage point
2. Reduces round-trips (1 request vs N)
3. Server can parallelize comparisons
4. Keeps client thin — no per-check logic on device

The tradeoff is that all tags at an anchor should be detectable from a similar viewpoint. If some checks require very different angles (e.g., top vs. front), those should be on separate anchors.

### Why SSIM for cleanroom checks?

For the listed use cases, SSIM is sufficient because:
- **Warning label present/missing** — label occupies a known region; SSIM drops sharply when it's absent
- **Correct language** — different language = different text = different pixel structure → SSIM catches this
- **Cable routing** — wrong routing = visual difference from reference → SSIM catches this
- **Missing parts** — absent part = structural difference → SSIM + histogram catches this
- **Gas line swapped** — different connector position = visual difference → SSIM catches this

The threshold tuning (currently `PASS_THRESHOLD=0.60`) may need per-tag adjustment. Consider adding a `threshold` field to Tag in a future iteration.

### iPhone as the only capture device

All inspection capture happens on iPhone. The Macbook is purely the SIB server — no camera use. This means:
- Authors must be in the cleanroom with the iPhone for training
- Operators use the iPhone in cleanroom for inspection
- Macbook stays outside cleanroom (or in clean office area) running SIB

---

## 11. Open Questions for Future Phases

1. **Per-tag confidence thresholds** — currently one global `PASS_THRESHOLD`. Should each tag type have its own threshold (e.g., language checks may need higher confidence)?
2. **Offline mode** — if WiFi drops in cleanroom, should the iPhone queue captures and sync later? 
3. **Multiple captures per validation** — should Operator take 3 angles like Author, or is 1 frame enough?
4. **QR code re-print strategy** — if QR is damaged, how do we re-associate a new QR with existing anchor+tags?
5. **Report format** — what does the downstream QA system expect? CSV, PDF, API push?
