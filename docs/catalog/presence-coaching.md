---
id: presence-coaching
name: Presence & coaching (multi-user AR)
area: guides
status: shipped
version: 2026.4.46
depends: [sealed-worldmap, tag-format, ai-guidance, uam]
terms: [AR Work Instructions, Author Mode, Operator Mode]
spec: CONNECTED-WORKER.md#presence-coaching-multi-user
api: |
  POST /anchors/:id/presence — heartbeat ~2×/s: pose, surface, focus, site, session (app · API key)
  GET /anchors/:id/presence — who is on this chamber right now (app, portal · API key)
  DELETE /anchors/:id/presence/:userId — leave (app · API key)
  GET /anchors/:id/subscribe — SSE: presence / presence:joined / presence:left / coach-hint on the chamber feed (app · API key)
  POST /guide-sessions/live/:id/hints — human coach hint with optional look-here pointer (app · API key)
wireframe: arguides
arch: |
  flowchart LR
    A["Author · Place Steps<br/>(map frame)"] -->|heartbeat| PR["in-memory presence<br/>30 s expiry · nothing persisted"]
    O["Operator · guide session<br/>(map frame, current step, session id)"] -->|heartbeat| PR
    I["Inspection Author<br/>(QR frame)"] -->|heartbeat| PR
    PR -->|"SSE presence events"| A & O & I
    A -->|"Coach: message · quick phrase · Point here"| H["POST /guide-sessions/live/:id/hints<br/>AIHint.source = human"]
    H -->|"coach-hint nudge"| O
    O --> V["'Priya says …' card · ring + beam 'look here' 20 s"]
---
Because every device localises into the chamber's shared frame, a colleague's
camera pose is directly comparable — no ARKit collaborative session. People on
the same chamber see each other as a world-locked lens, view cone and gaze dot,
with edit echo when someone saves and a soft lock on the step they are on.
Operators publish presence too, so an author in Place Steps can coach them: a
message, a quick phrase, or "Point here" that lands as a look-here marker in the
operator's view, routed through the same consume-once hint channel the AI
adapter uses.
