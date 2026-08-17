---
id: reference-links
name: Reference link per step
area: designer
status: shipped
version: 2026.4.42
depends: [step-content-authoring]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
arch: |
  flowchart LR
    URL["linkUrl authored in the Inspector - any http(s) URL"] --> NODE["Stored on the canvas node"]
    NODE --> COMP["compiler.ts -> GuideStep.linkUrl at export"]
    COMP --> ING["Carried through ingest - survives re-sync"]
    ING --> IOS["Reference button on the AR step panel - opens in Safari"]
    NOTE["Platform stores no copy - the link is the pointer of record"] -.-> URL
---
Any http(s) URL — a video, a PDF, the SOP page — authored on a step in the Inspector,
carried through compile → export → ingest, and surfaced as a tappable "Reference"
button on the iOS AR step panel (opens in Safari). The platform stores no copy; the
link is the pointer of record.
