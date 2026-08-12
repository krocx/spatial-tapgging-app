# iLOTO — Spatial Lockout/Tagout

Status: **approved design** (2026-08-12) · Slice 1 in build
Regulatory frame: OSHA 29 CFR 1910.147 (control of hazardous energy)

---

## 1. What this is

AR-assisted tracking and audit of Safe Off and LOTO on cleanroom control
panels, built on the existing spatial platform: an **anchor is one control
panel** (QR code + ARWorldMap, unchanged), authored **points** mark its circuit
breakers and switches, and every apply/remove is an **append-only event** in
SIB with photo evidence.

**The stance that keeps this defensible:** the app is the *record and
verification aid*; the physical lock is the safety control. UI copy never says
"safe" — it says "recorded as isolated — verify physically." Status is always
derived from the event log, never edited.

## 2. Site semantics (decided 2026-08-12)

| Term | Meaning | Lock | Checklist |
|---|---|---|---|
| **Safe Off** | Out-of-service / operational lock on a **circuit breaker**. Equipment stays down; nobody is working inside it. Independent of LOTO. | Yellow | Shortened: shutdown confirm → apply → photo → serial. No try-test mandate; affected-notification optional. |
| **LOTO** | Personal danger lock on a **switch** — someone is working on the equipment. | Red | Full six-step: notify → shutdown → apply → photo → **try test** → serial. |

Decisions on the other forks:

- **Removal**: strict same-person, plus a **supervisor override** flow —
  supervisor identity + the three OSHA exception confirmations (verified
  absent / contact attempted / will be informed before return) + free-text
  reason. Stored as its own event type; pinned in portal audits.
- **Group lockout**: deferred. `LotoEvent` references a point (not vice
  versa), so multiple concurrent locks per point is a later UI change, not a
  schema migration. V1 enforces **one active lock per point**.
- **Training content**: seeded question bank drafted from 1910.147, stored as
  editable data in SIB; EHS team edits before go-live. Certification expires
  after 12 months (configurable).

## 3. Navigation

```
Mode selection → iLOTO → Anchor directory (loto anchors)
  → create anchor (QR + worldmap, existing flow)
  → iLOTO Hub (status banner + 6 tiles)
      Safe Off        → Apply · Remove · Define points (author)   [cert-gated]
      LOTO            → Apply · Remove · Define points (author)   [cert-gated]
      Check Status    → AR walk-around · list fallback            [open]
      My LOTO         → my active locks across ALL anchors        [open]
      AR LOTO Map     → view · create/edit/delete (author)        [view open]
      My LOTO Training→ quiz → certification                      [open]
```

The hub leads with a live status banner ("2 LOTO active · 1 safe off · last
event 14:02") — the first question at a panel is always *what state is it in*.

Cert gate: Safe Off and LOTO tiles are locked until the user holds a valid,
unexpired certification; tapping routes to Training. Everything else stays
open — an *affected* employee must be able to see state without being
authorized to change it.

## 4. Data model

All records live in SIB `JsonFileStore`s. Identity = the app's author-name
identity (same as guide sessions); treat as the acting user id.

### LotoPoint — authored inventory

One per breaker/switch. Authored in AR via the existing tag-placement flow;
**placement is device-owned** (same invariant as tags/steps everywhere).

```
id, anchorId, kind: 'safeoff' | 'loto', label, circuitId?,
position {x,y,z}, modelId?, modelScale?,        // lock 3D asset (Model3D library)
createdBy, createdAt, updatedAt
```

Operators act only on authored points — ad-hoc points would destroy audit
integrity.

### LotoEvent — append-only, the source of truth

```
id, anchorId, pointId, type: 'apply' | 'remove' | 'override-remove',
userId, userName,
lockSerial?,
checklist: Record<string, boolean>,   // snapshot of the confirms shown
photoPath?,                            // evidence photo (JPEG store)
override?: { supervisorName, reason,
             verifiedAbsent, contactAttempted, willInformBeforeReturn },
note?, createdAt
```

Rules enforced at POST (the server is the referee, not the client):

1. `apply` — point must exist; point must have **no active lock** (v1);
   required checklist keys for the point's kind must all be true
   (LOTO: `notifiedAffected, shutDown, tryTestNoStart`; Safe Off: `shutDown`);
   photo required for both kinds.
2. `remove` — point must have an active lock; `userId` must equal the
   applying user's id.
3. `override-remove` — point must have an active lock; all three override
   confirmations true; supervisorName + reason non-empty.
4. Events are never updated or deleted. No PATCH/DELETE routes exist.

### Derived status (never stored)

For a point: latest event wins — `apply` → `locked` (with owner/since/serial);
`remove`/`override-remove` → `clear`. Panel status = aggregation. Endpoints
compute this on read.

### LotoCertification

```
id, userId, userName, score, total, passed,
issuedAt, expiresAt          // issuedAt + validityDays (default 365)
```

Valid = `passed && now < expiresAt`. The server issues certs only from a quiz
submission it grades itself (answers never leave the server in the question
payload).

### LotoQuizQuestion (seeded bank)

```
id, prompt, choices[], correctIndex, explanation
```

Seeded from OSHA 1910.147 on first boot if the store is empty; editable data,
not code. GET strips `correctIndex`/`explanation`; grading happens on POST.

### LotoMap (slice 4, schema reserved)

Versioned stroke arrays in anchor world space; each stroke optionally linked
`fedByPointId` so safe-offing a breaker renders downstream segments
de-energized.

## 5. Server API (slice 1)

```
POST   /loto/points                    author: create point
GET    /loto/points?anchorId=          list points
PATCH  /loto/points/:id                author: label/circuit/model/position
DELETE /loto/points/:id                author: remove (blocked while locked)

POST   /loto/events                    apply / remove / override-remove
GET    /loto/events?anchorId=[&pointId=]  audit trail, newest first
GET    /loto/events/photo/:filename    evidence photo

GET    /loto/status?anchorId=          derived per-point + panel summary
GET    /loto/my?userId=                my active locks across anchors

GET    /loto/quiz                      questions (no answers)
POST   /loto/quiz/submit               grade → certification record
GET    /loto/certifications?userId=    newest first; head = current
```

## 6. Checklists (v1 definitions)

LOTO apply: `notifiedAffected` → `shutDown` → *[apply physical lock]* → photo
→ `tryTestNoStart` → serial. LOTO remove: `toolsRemoved` → `personnelClear` →
`notifiedAffected` → *[remove lock]* → photo. Safe Off apply: `shutDown` →
photo → serial. Safe Off remove: `personnelClear` → photo.

The checklist keys are part of the event snapshot so an audit shows exactly
what was confirmed, per event, even if definitions evolve later.

## 7. Build phasing

| Slice | Scope |
|---|---|
| 1 | Shared types, SIB stores + routes + seeded quiz, derived status, iOS hub (6 tiles, status banner, cert gate), 'loto' anchor type |
| 2 | Point authoring in AR (yellow/red lock assets), Apply/Remove checklists with photo + try-test, supervisor override, Check Status AR/list |
| 3 | My LOTO cross-anchor view + shift-end notice, quiz UI, cert issuance live |
| 4 | AR LOTO map: vertex-drawn flow lines, circuit links, status-aware rendering, versions |
| Portal | With each slice: status board → audit trail (overrides pinned) → cert registry → CSV export |

## 8. Deliberate non-goals (v1)

- No claim of being the safety system of record — the physical lock is.
- No group lockout UI (schema ready; see §2).
- No editing or deleting events, by anyone, including admins.
- No offline queueing — cleanroom connectivity is assumed; if that proves
  wrong, queued events need careful conflict rules (tracked as a risk, §9).

## 9. Open questions / risks

1. Offline: a failed POST during apply leaves physical state ahead of the
   record. V1 answer: the app blocks the flow's "done" until the server
   confirms; revisit if connectivity is poor in practice.
2. Identity strength: author-name identity is self-asserted. Acceptable for
   v1 audit trail; SSO/RBAC is the real fix (same open item as the
   Procedure Designer).
3. Annual periodic-inspection workflow (1910.147(c)(6)) — a portal checklist
   for an uninvolved authorized employee. Not scheduled; candidate slice 5.
