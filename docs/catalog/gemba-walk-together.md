---
id: gemba-walk-together
name: Walk together, phone-down navigation, resume checkpoint
area: gemba
status: shipped
version: 2026.4.46
depends: [gemba-walk-sessions, loc-tags, presence-coaching]
terms: [Gemba Walk, ARWorldMap]
spec: GEMBA-WALK.md
api: |
  POST /anchors/:id/presence — auditors on the same space share pose and surface gembaWalk (app · API key)
  GET /anchors/:id/subscribe — loc-tags events refresh a colleague's findings and panels live (app · API key)
  POST /loc-tags/:id/compare — arrival drift check: live frame vs the finding photo (app · API key)
wireframe: gemba
flow: |
  flowchart LR
    W["walk in progress"] --> P["colleague auditors: lens · cone · roster<br/>their findings appear as they save"]
    W --> LA["Live Activity on lock screen / Dynamic Island<br/>navigate · arrived · paused · background"]
    BG["app backgrounded or killed"] --> CK["Welcome back checkpoint<br/>last-good finding photo · confirm or re-align · 15 s → relocalize"]
    CK --> R["continue at #N (progress persisted 12 h)"]
    AR["arrival at a finding"] --> DR["SSIM drift check → prompt re-align on low similarity"]
---
Several auditors can walk one space at once and see each other and each other's
findings as they are logged; operators can walk phone-down with the next stop on
the lock screen and Dynamic Island. iOS suspends ARKit the moment the app
leaves the foreground, so a checkpoint greets every return — the last good
finding photo as a landmark, confirm or re-align, a timeout into full
relocalization — and progress survives a kill. On arrival at a finding a
similarity check against its photo prompts a re-align before anything is judged.
