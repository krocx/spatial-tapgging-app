---
id: ai-guidance
name: AI-assisted guidance
area: guides
status: shipped
version: baseline
depends: [live-telemetry, stall-detection, adapter-architecture]
terms: [Adapter, AI Dynamic Instructions]
spec: ../README.md
---
An adapter watches the live session stream and decides when to help; hints are
delivered through a consume-once queue and auto-dismissed when their step completes.
Today's adapter is rule-based (retries, stalls); the interface is the point — a
local model drops in without touching the client.
