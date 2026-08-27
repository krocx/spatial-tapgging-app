---
id: tag-format
name: .tag virtual emitter (v1)
area: platform
status: beta
version: 2026.4.42
depends: [qr-anchoring, shared-schema]
terms: [Anchor]
spec: TAG-FORMAT.md
sensitivity: restricted
api: |
  GET /tags/:id/emit — signed part-level .tag envelope (app · API key)
  GET /anchors/:id/emit — signed assembly-level (chamber) .tag envelope with member manifest (app · API key)
  GET /anchors/:id/subscribe — SSE change feed: state on connect, changed with per-stream/member delta names (app · API key)
arch: |
  flowchart LR
    subgraph SIB["SIB tag/ (emitter + reference validator)"]
      CORE["tag-core.ts: canonicalize + SHA-256 + Ed25519 + validate"]
      EM["tag-emitter.ts: gather stores, hash streams, sign"]
      KEY[("tag-signing-key.json - issuer Ed25519, data-scope backups")]
      EM --> CORE
      EM --> KEY
    end
    subgraph Emissions
      P["GET /tags/:id/emit - kind: part"]
      A["GET /anchors/:id/emit - kind: assembly + member manifest (Merkle links)"]
      S["GET /anchors/:id/subscribe - SSE: store-write bus, debounced diff, names changed streams/members"]
    end
    EM --> P
    EM --> A
    EM --> S
    subgraph iOS["iOS reader (TagEnvelope.swift)"]
      RD["parse + canonicalize + verify signature"] --> PIN["pin issuer key on first scan"]
      PIN --> CACHE[("Documents/tags/*.tag - offline, re-verified on read")]
    end
    P --> RD
    A --> RD
---
Every tagged part — and the chamber assembly above it — can emit a small,
signed, tamper-evident envelope: identity, spatial pose, and every data stream
as a reference plus SHA-256 hash, never inline payloads. Assembly envelopes
carry a member manifest hashing each part envelope beneath them, so one
signature commits to the exact state of the whole chamber. Deterministic
emission (no timestamps, no floats-as-numbers) means identical content always
yields identical bytes; readers verify offline and pin the issuer key on first
scan. First consumer is our own iOS app — third parties only ever interact
through authorised API channels.
