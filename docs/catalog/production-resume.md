---
id: production-resume
name: Production-verified resume + pilot hardening
area: guides
status: shipped
version: 2026.4.45
depends: [guide-lifecycle, kiosk-shift]
terms: [AR Work Instructions, Operator Mode]
spec: CONNECTED-WORKER.md#production-verified-resume
wireframe: arguides
flow: |
  flowchart LR
    R["resume snapshot found"] --> M{"same Production #?"}
    M -->|yes| C["continue at the step you left"]
    M -->|no| P["prompt: Switch & Resume · Start fresh on current #"]
    M -->|unstamped| C
---
An interrupted guide run belongs to its Production #: resume snapshots carry the
shift's work context, and a snapshot from a different system is never picked up
silently - the operator chooses Switch & Resume or Start fresh. The same release
hardened the pilot loop: a fail-branch action on the FAIL dialog, an offline
sign-off queue that finalises when the network returns, name prefill from the
kiosk identity, an incomplete-submit warning and a redirect toast.
