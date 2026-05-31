# Cloud Migration & Enterprise Security Specification
**Project:** Spatial Tagging App — SIB (Spatial Intelligence Backend)  
**Status:** Active Roadmap — Phase 3 planning  
**Last Updated:** 2026-05-29  
**Assumes:** Phase 2.5 complete (see §1 for what 2.5 delivers)

---

## 1. Phase 2.5 Baseline (Already Delivered Before Phase 3 Starts)

Phase 3 planning assumes the following are in production from Phase 2.5:

| Deliverable | How It Works |
|---|---|
| **Client-side AES-256 image encryption** | Pass-state images encrypted on-device (iOS CryptoKit) before upload. Server stores ciphertext only. Decryption key embedded in QR code. Only devices that scan the QR can decrypt. |
| **HTTPS enforced** | Render provides automatic TLS. `NSAllowsArbitraryLoads` removed from iOS Info.plist. All traffic is TLS 1.2+ minimum. |
| **API key auth** | `X-API-Key` header required on all SIB routes. Keys stored in Render environment variables. Separate keys for dev/prod environments. |
| **Render deployment** | SIB containerised (Dockerfile). Persistent disk mounted at `/data/.sib-data/`. Data survives deploys and restarts. |
| **Anchor readiness gate (G1)** | SIB enforces minimum trained-tag threshold before an anchor is visible to Operator mode. |
| **In-app QR generator (G7)** | Authors generate and share anchor QR codes from within the iOS app — no CLI tools needed. QR payload includes `anchorId`, `assetId`, and the AES encryption key for that anchor. |
| **All UX gaps closed** | G3 (offline UX), G4 (unpositioned tag indicator), G6 (session ID in UI) resolved. |
| **Inspection logger** | Every `validate-all` call appends a structured record to `inspection-logs.json` on the persistent disk. |

**Security posture after Phase 2.5:**
- Data in transit: encrypted (TLS)
- Pass-state images at rest: encrypted (AES-256-GCM, client-managed keys embedded in QR)
- Metadata at rest (anchors, tags, logs): unencrypted JSON on Render persistent disk — Render infrastructure-level security applies
- Authentication: shared API key per environment (not per-device identity)
- **Suitable for:** internal team testing and client pilot trials
- **Not yet suitable for:** multi-operator enterprise deployments, regulatory audit requirements, storing PII

---

## 2. Current Architecture (Post Phase 2.5)

```
iOS App (CryptoKit encrypted)
    │
    ├─── HTTPS + X-API-Key ──►  SIB (Node/Express on Render)
    │                               │
    │                               ├── /data/.sib-data/anchors.json
    │                               ├── /data/.sib-data/tags.json
    │                               ├── /data/.sib-data/pass-states.json   ← encrypted blobs
    │                               └── /data/.sib-data/inspection-logs.json
    │
Rayneo XR (same HTTPS + API key)
```

**Remaining limitations to resolve in Phase 3:**

| Limitation | Phase that resolves it |
|---|---|
| Shared API key — no per-device identity or audit trail | 3A |
| JSON flat-files — no concurrent writes, no query | 3B |
| Pass-state images on disk — no scalable object storage | 3D |
| All data in one namespace — no multi-tenant isolation | 3C |
| No web dashboard for inspection history | 3E |
| No automated DB backups with point-in-time recovery | 3B |

---

## 3. Phase 3 Migration Plan

### Phase 3A — JWT Device Authentication (1–2 weeks)
**Goal:** Replace shared API key with per-device identity. Every action is attributable to a specific enrolled device.

**Prerequisites (all met by Phase 2.5):**
- ✅ HTTPS enforced (JWT must never travel over plain HTTP)
- ✅ iOS Keychain used for sensitive storage (API key already there — JWT goes same place)
- ✅ SIB has working auth middleware (API key — upgrade to JWT verification)

**Deliverables:**
- `POST /auth/register-device` — enroll a new iOS or Rayneo device; returns a device ID
- `POST /auth/token` — exchange device credentials for a short-lived JWT (15-minute access token + 30-day refresh token)
- JWT middleware replaces API key check on all routes
- JWT claims: `{ deviceId, role: AUTHOR|OPERATOR, orgId, exp }`
- iOS: store JWT in Keychain; auto-refresh before expiry
- Author role: can create/edit/delete tags, train pass-states, generate QR
- Operator role: can only read tags and call validate-all

**Note on encryption keys:** The AES key for each anchor is already distributed via QR code. Phase 3A does not change this. JWT controls *who can access the API*; the QR key controls *who can decrypt images*.

---

### Phase 3B — PostgreSQL Migration (2 weeks)
**Goal:** Replace JSON flat-files with a relational database. Enables concurrent writes, proper queries, and automated backups.

**Prerequisites:**
- ✅ Phase 3A complete (device IDs and orgIds needed as foreign keys)
- Render Postgres instance provisioned (see §5 parallel infra checklist)

**Schema (maps directly from current JSON stores):**

```sql
-- Core tables
anchors             (id, asset_id, org_id, coordinate_system, position, rotation, metadata, created_at, updated_at)
tags                (id, anchor_id, org_id, type, label, expected_outcome, check_description, order, metadata, created_at, updated_at)
pass_states         (id, tag_id, anchor_id, asset_id, org_id, created_at, updated_at)
pass_state_images   (id, pass_state_id, storage_key, mime_type, pose, captured_at)  -- storage_key = path on disk/S3
sessions            (id, device_id, org_id, asset_id, user_id, start_time, end_time, created_at, updated_at)

-- Inspection log (maps from inspection-logs.json)
inspection_sessions (id, session_id, anchor_id, asset_id, org_id, device_id, threshold, started_at, duration_ms,
                     overall_status, pass_count, fail_count, pending_count, total_count)
inspection_tag_results (id, inspection_session_id, tag_id, tag_label, tag_type, status, confidence)

-- Append-only audit log
audit_log           (id, occurred_at, org_id, device_id, role, action, resource_type, resource_id, outcome, metadata)
```

**Migration approach:**
1. Deploy updated SIB with DB adapters behind the same `JsonFileStore` interface
2. Run migration script: read JSON files → `INSERT` into Postgres
3. Enable parallel write (JSON + DB) for one week to validate parity
4. Cut over: disable JSON writes, keep files as read-only backup for 30 days
5. Archive JSON files to S3 (retain 1 year)

**Backup policy:** Render Postgres automatic daily snapshots, 7-day retention on standard plan (upgrade to 35-day for production).

---

### Phase 3C — Multi-Tenant RBAC & Organisation Model (2–3 weeks)
**Goal:** Support multiple independent customers on a single SIB instance. Data is strictly isolated between organisations.

**Prerequisites:**
- ✅ Phase 3B complete (DB with org_id columns ready)
- ✅ Phase 3A complete (JWT carries orgId claim)

**Deliverables:**
- Tenant provisioning: `POST /admin/orgs` — create an organisation
- Device-to-org binding enforced at JWT issuance
- All DB queries scoped by `orgId` from JWT — cross-tenant access is impossible at query level
- PostgreSQL Row Level Security (RLS) as second line of defence
- Separate AES key namespaces per organisation (QR keys are already per-anchor; this adds per-org key management for future use)
- Admin role: can manage devices and view all data within their org

---

### Phase 3D — S3 Image Offload (1 week)
**Goal:** Move encrypted image blobs from the Render persistent disk to object storage. This is a **scalability** move — images are already encrypted by Phase 2.5, so this phase adds no new security, only storage scale and redundancy.

**Prerequisites:**
- ✅ Phase 3B complete (pass_state_images table has storage_key column)
- ✅ Images already AES-256 encrypted client-side (Phase 2.5) — safe to store anywhere
- S3 bucket or Cloudflare R2 provisioned (see §5)

**Deliverables:**
- SIB uploads encrypted blobs to S3/R2 on `POST /perception/train`
- `storage_key` stored in DB; blob never written to local disk
- Pre-signed download URLs (15-minute TTL) returned to authorised clients
- Backfill job: migrate existing blobs from disk to S3
- Bucket policy: private, no public access, versioning enabled

**Why Cloudflare R2 over AWS S3:** Zero egress cost. When Operator devices download reference images for comparison, egress from R2 is free. At scale this matters — a typical inspection downloads 7 reference images per tag × N tags per anchor.

---

### Phase 3E — Web Dashboard (4–6 weeks)
**Goal:** Browser-based UI for inspection history, audit logs, and anchor management. Replaces reading JSON files manually.

**Prerequisites:**
- ✅ Phase 3B complete (DB queries power the dashboard)
- ✅ Phase 3C complete (org-scoped views)

**Key pages:**

| Page | Who sees it | What it shows |
|---|---|---|
| Inspection Sessions | Author, Operator, Admin | List of all `validate-all` calls: date, anchor, operator device, PASS/FAIL, duration, threshold used |
| Session Detail | Author, Operator, Admin | Per-tag results, confidence scores, link to re-inspect |
| Audit Log | Admin only | Every create/update/delete action, device identity, timestamp |
| Anchor Manager | Author, Admin | All anchors, their tags, training status, readiness gate status |
| Export | Admin | CSV export of inspection sessions for QMS / compliance tools |

**Tech stack:** Next.js (App Router) deployed on Vercel. Calls SIB REST API with JWT. No direct DB access from frontend.

---

## 4. Encryption Architecture (Complete Picture)

### Data in Transit
| Path | Protocol | Status |
|---|---|---|
| iOS → SIB | TLS 1.2+ (Render auto-cert) | ✅ Phase 2.5 |
| Rayneo → SIB | TLS 1.2+ | ✅ Phase 2.5 |
| SIB → Postgres | TLS enforced by Render | Phase 3B |
| SIB → S3/R2 | HTTPS (enforced by provider) | Phase 3D |

### Data at Rest — Images (Pass-State)
| Layer | Method | Key holder | Status |
|---|---|---|---|
| Application (client-side) | AES-256-GCM | Device/QR (you, not Render) | ✅ Phase 2.5 |
| Disk / S3 | Provider-managed | Render / AWS / Cloudflare | Already present |

**Key insight:** Because Phase 2.5 delivers client-side encryption, the server is a dumb encrypted-blob store. A full breach of the Render server, the Postgres database, or the S3 bucket exposes no readable images. The only way to decrypt is to have the AES key that lives in the QR code — which never touches the server.

### Data at Rest — Metadata (Tags, Anchors, Logs)
| Layer | Method | Phase |
|---|---|---|
| Postgres | TLS + provider-managed disk encryption | 3B |
| Application-level field encryption (labels, check descriptions) | AES-256-GCM, if required by client contracts | Optional Phase 4 |

---

## 5. Parallel Infra Checklist (For GIS — Run While Phase 2.5 Is in Development)

Your team can prepare the cloud infrastructure now, independently of the app development work.

### Do Immediately (no code dependency)

- [ ] **Create Render account** — set up an org workspace, invite team members with appropriate roles (Owner, Member)
- [ ] **Reserve a custom domain** — e.g. `sib.yourcompany.com`. Register if needed. You will point DNS to Render when 2.5 is deployed.
- [ ] **Plan disk sizing** — each anchor ≈ 50 MB encrypted pass-state images. Estimate your pilot anchor count × 50 MB, then add 3× headroom. Start with 10 GB Render disk.
- [ ] **Generate API keys** — create two separate keys: `SIB_API_KEY_DEV` and `SIB_API_KEY_PROD`. Store securely (password manager). These go into Render environment variables when deploying.
- [ ] **Set up two Render environments** — one Web Service for `dev` (internal testing) and one for `prod` (pilot use). Separate disks, separate API keys.
- [ ] **Review Render's DPA** — if handling client data in pilots, sign Render's Data Processing Agreement. Available at render.com/dpa.

### Prepare for Phase 3A (JWT Auth)

- [ ] **Decide on JWT signing key rotation policy** — recommend 90-day rotation. Plan how you will rotate without revoking active devices mid-inspection.
- [ ] **Document device onboarding process** — who is authorised to call `POST /auth/register-device`? How are new operator devices enrolled on a factory floor?

### Prepare for Phase 3B (Database)

- [ ] **Provision Render Postgres** — Starter plan is fine for pilot scale. Note: Render Postgres is **separate** from the SIB web service; provision it now so it's ready.
- [ ] **Enable automated backups** — confirm backup retention policy meets your needs (7 days on Starter, 35 days on Standard).
- [ ] **Test connection from SIB** — before migration, confirm the SIB container can reach the Postgres instance via Render's private network.

### Prepare for Phase 3D (Image Storage)

- [ ] **Choose: Cloudflare R2 or AWS S3** — R2 recommended for zero egress cost. Create the bucket, enable versioning, record the access keys.
- [ ] **Set bucket policy** — private, no public access. Only the SIB service account can read/write.
- [ ] **Estimate storage cost** — each encrypted image ≈ 200–500 KB. 7 images per tag × 20 tags per anchor × 50 anchors = ~350 MB. Well within R2 free tier (10 GB) for pilot scale.

---

## 6. Audit Log Events (Append-Only)

Every mutation is logged. Rows are never updated or deleted.

| Action constant | Triggered by |
|---|---|
| `ANCHOR_CREATED` | POST /anchors |
| `TAG_CREATED` | POST /tags |
| `TAG_UPDATED` | PATCH /tags/:id |
| `TAG_DELETED` | DELETE /tags/:id |
| `PASS_STATE_TRAINED` | POST /perception/train |
| `INSPECTION_RUN` | POST /perception/validate-all |
| `DEVICE_REGISTERED` | POST /auth/register-device |
| `AUTH_SUCCESS` | POST /auth/token |
| `AUTH_FAILURE` | POST /auth/token (bad credentials) |
| `QR_GENERATED` | In-app QR generation (G7) |

---

## 7. Compliance Readiness

| Requirement | After Phase 2.5 | After Phase 3 (full) |
|---|---|---|
| Data encrypted in transit | ✅ TLS | ✅ TLS |
| Sensitive images encrypted at rest | ✅ Client-side AES-256 | ✅ + S3 server-side |
| Per-user audit trail | ❌ Shared API key | ✅ JWT device identity |
| Access control (RBAC) | ❌ | ✅ Phase 3A/3C |
| Inspection record retention | ✅ JSON log | ✅ Postgres + S3 archive |
| Multi-tenant isolation | ❌ | ✅ Phase 3C |
| Point-in-time DB recovery | ❌ | ✅ Phase 3B |
| 21 CFR Part 11 (electronic records) | Partial | ✅ with audit log + Phase 3E export |

---

## 8. Revised Timeline

| Phase | Deliverable | Estimated Effort | Team |
|---|---|---|---|
| **2.5** | UX gaps + client encryption + Render deploy | 2–3 weeks | App dev team |
| **3A** | JWT device auth | 1–2 weeks | App dev team |
| **3B** | PostgreSQL migration | 2 weeks | App dev + infra |
| **3C** | Multi-tenant RBAC | 2–3 weeks | App dev + infra |
| **3D** | S3 image offload | 1 week | App dev + infra |
| **3E** | Web dashboard | 4–6 weeks | Frontend team |

**Parallel work during Phase 2.5:** Infra team completes §5 checklist. By the time Phase 3A begins, the Render account, domain, Postgres instance, and R2 bucket are ready and waiting.

---

*Security architecture reviewed: 2026-05-29. Review again before Phase 3A goes to production.*
