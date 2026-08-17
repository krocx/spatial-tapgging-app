---
id: edge-roles
name: Edge roles — switcher, legend, explainer
area: designer
status: shipped
version: 2026.4.42
depends: [procedure-maps]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
wireframe: procdes
arch: |
  flowchart LR
    SEL["Select a connection on a procedure map"] --> SW["Role switcher in the side panel: Next / On failure / Requires"]
    SW --> ROLE["edge.role in @spatial/shared - preserved by sanitizeEdge"]
    ROLE --> CEN["Census legend - line swatches per role"]
    ROLE --> COMP["compiler.ts maps roles to nextOnSuccess / nextOnFailure / precondition"]
    EXPL["? panel - paths vs rules in operator language"] -.-> SW
---
Connections on a procedure map are Next, On failure, or Requires — select one and
change its role in the side panel instead of delete-and-redraw. A census line-swatch
legend and a ? explainer separate paths (Next / On failure) from rules (Requires),
in operator language.
