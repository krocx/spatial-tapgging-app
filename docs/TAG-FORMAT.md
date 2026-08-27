# The .tag Envelope Format — v1 (tag/1.0)

**PROPRIETARY & CONFIDENTIAL — Applied Materials. Patent pending.**
**Internal distribution only. Do not circulate externally prior to filing.**

The `.tag` file is the platform's **virtual emitter**: a small, signed,
tamper-evident envelope that gives a physical part — and the chamber it lives
on — a portable spatial identity. It carries *references and hashes*, never
heavy payloads; readers resolve the streams they need through authorised
channels (our API), and can verify everything they receive against the
envelope offline.

Layer map (see the .tag/.sib architecture deck):

| Layer | Artifact | Governance |
|---|---|---|
| L1 | This envelope spec | Licensable in future — the "PDF of spatial identity" |
| L2 | Reader Conformance Profile (§6) | Brand-governed certification |
| L3 | `.sib` backend (stores, perception, relationships) | Proprietary. Never licensed. |

First consumer: our own iOS app, offline and online (§7). Third parties only
ever interact via API or future authorised channels — never by reading `.sib`
internals.

---

## 1. Two kinds, one format (the CAD model)

Mirroring CAD part / part-assembly files:

- **`kind: "part"`** — one tagged part on a chamber. Emitted at
  `GET /tags/:id/emit`. Subject = the part (label, type, owning `anchorId`),
  its spatial pose, and part-scoped streams.
- **`kind: "assembly"`** — the chamber itself (an anchor). Emitted at
  `GET /anchors/:id/emit`. Subject = the chamber, chamber-scoped streams, and
  a **member manifest**: one entry per part with the SHA-256 of that part's
  canonical payload. The assembly signature therefore commits to the exact
  version of every part beneath it — a Merkle-style integrity tree. Change
  any part → its hash changes → the assembly manifest is provably stale until
  re-emitted.
- **`kind: "group"`** — *reserved* for TagGroup sub-assemblies (v1.1). Readers
  MUST reject kinds they don't recognise.

## 2. Envelope structure

```jsonc
{
  "payload": {
    "format": "tag/1.0",
    "kind": "part" | "assembly",
    "subject":  { "id", "label", "anchorId?", "assetId?", "type?" },
    "issuer":   { "platform": "SIB", "version": "<platform version>" },
    "spatial?": { "x": "0.100000", "y": "0.200000", "z": "0.300000" },
    "streams":  [ { "name", "ref", "sha256", "contentVersion?" } ],
    "members?": [ { "tagId", "label", "ref", "sha256" } ],   // assembly only
    "subscribe": { "hints": [ "<url>" ] },                    // v1: hints only
    "contentVersion": "<max updatedAt of committed content>"
  },
  "signature": { "alg": "Ed25519", "publicKey": "<raw32 b64>", "sig": "<raw64 b64>" }
}
```

**Determinism rules (normative):**
- The payload carries **no emission timestamp**. `contentVersion` is the max
  `updatedAt` of the committed content — identical content always produces
  identical bytes, hashes and signatures. Emissions are cacheable and
  independently reproducible.
- The payload contains **no JSON numbers**. Floats (spatial coordinates)
  travel as fixed 6-decimal strings. This makes canonicalization (§3) exactly
  reproducible in every language without float-formatting ambiguity.
- `undefined`/absent optional fields are omitted entirely, never `null`.

**Security rules (normative):**
- Anchor AES encryption keys are NEVER embedded in an envelope.
- `ref` URLs are relative; they resolve only against an authorised SIB origin
  with a valid API key. An envelope alone grants no data access.

## 3. Canonical serialization

Canonical form = JSON with object keys sorted lexicographically at every
level, no insignificant whitespace, arrays in author order, string escaping
per ECMA-404/JSON.stringify. Reference implementation:
`sib/src/tag/tag-core.ts → canonicalize()`.

`payloadHash = SHA-256( canonicalize(payload) )`, lowercase hex. This is the
value member manifests and external verifiers commit to.

## 4. Signature

Ed25519 over the canonical payload bytes. `signature.publicKey` is the raw
32-byte issuer public key (base64); `sig` is the raw 64-byte signature
(base64). The issuer keypair is generated on first boot and persisted at
`<SIB_DATA_DIR>/tag-signing-key.json` (top-level JSON → included in `data`
scope backups). Rotation: delete the file, restart, re-pin readers.

Trust model v1: **trust-on-first-scan, pin thereafter.** A reader may accept
the embedded key on first contact with a deployment, then MUST pin it and
reject envelopes signed by any other key. Enterprise PKI (per-site issuer
certificates) is an L2/M2 concern.

## 5. Stream registry (v1)

| name | kind | resolves at | content hashed |
|---|---|---|---|
| checkpoint | part | `/tags/:id` | the tag record |
| training | part | `/perception/pass-state/:tagId` | pass-state record |
| group | part | `/tag-groups/:id` | group record |
| anchor | assembly | `/anchors/:id` | anchor record (encryption key stripped) |
| worldmap | assembly | `/worldmap/:anchorId` | ARWorldMap file bytes |
| guides | assembly | `/guides?anchorId=` | guide + step records |
| models | assembly | `/models?anchorId=` | kit + general model records |
| loto | assembly | `/loto/status?anchorId=` | points + events records |
| gemba | assembly | `/loc-tags?anchorId=` | finding records |
| inspections | assembly | `/sessions` | session records for the chamber |

Streams are omitted when the underlying data doesn't exist (no filler).
Unknown stream names MUST be ignored by readers (forward compatibility).

## 6. Conformance (seed of the L2 Reader Profile)

A conformant reader:
1. Parses the envelope and rejects unknown `format` / `kind`.
2. Recomputes the canonical payload and verifies the Ed25519 signature.
3. Enforces the pinned issuer key after first contact.
4. Verifies each resolved stream against its `sha256` before use.
5. Treats `ref` URLs as authorised-channel-only (API key attached).
6. Ignores unknown stream names; never writes back through `.tag`.

Reference validator: `validateTagEnvelope()` in `tag-core.ts` — structure,
determinism rules, and signature, returning human-readable violations.
Exercised by `sib/test/tag-format.test.ts` including a full emit → validate →
tamper → re-validate cycle.

## 7. Offline flow (first consumer: our iOS app)

Scan QR → anchor id → `GET /anchors/:id/emit` → verify + pin → cache the
envelope (and any streams fetched) in the app's Documents. Offline, the app
re-verifies the cached envelope's signature and serves cached streams; on
reconnect it re-emits, compares `contentVersion`/hashes, and refreshes only
streams whose hashes changed. Reference reader:
`ios-app/.../Services/TagEnvelope.swift`.

## 8. Versioning

`format: "tag/<major>.<minor>"`. Minor = additive (new streams, new optional
fields); readers ignore what they don't know. Major = breaking; readers MUST
refuse and prompt for an update. This file is the change log of record for
the format itself.
