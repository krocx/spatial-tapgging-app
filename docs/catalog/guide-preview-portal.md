---
id: guide-preview-portal
name: Guide Preview in the portal
area: portal
status: shipped
version: 2026.4.42
depends: [guide-library, conditional-graph]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
wireframe: portal
arch: |
  flowchart LR
    BTN["Preview button in Guide Library"] --> FETCH["GET /guides/:id + /guides/:id/steps"]
    FETCH --> PHONE["Phone-frame modal - client-side only, nothing saved"]
    PHONE --> WALK{"Complete / Failed / Skip"}
    WALK -->|complete| NS["nextOnSuccess or next sequence"]
    WALK -->|failed| NF["nextOnFailure - or stay and retry"]
    GATE["precondition unmet -> visible redirect to required step"] --> PHONE
    PHONE --> IMG["Step images via GET /guides/step-image/:filename"]
    PHONE --> TTS["Voice via browser speechSynthesis (footnote: iOS differs)"]
    WALK --> SUM["Exit summary: steps never reached, failure branches never exercised"]
    BAN["Placement banner: N of M placed - operators can't run yet"] --> PHONE
---
Walk any guide's real branch graph from a desk: a phone-frame walkthrough in the
Guide Library with Complete/Failed/Skip traversal, requires-gate redirects, step
images, voice playback, and an exit summary of everything a happy-path review
never exercised. A placement banner keeps reviewers honest — approving content
is not the same as the guide being runnable on the floor.
