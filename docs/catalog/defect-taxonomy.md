---
id: defect-taxonomy
name: Defect taxonomy + severity
area: gemba
status: shipped
version: baseline
depends: [loc-tags]
terms: [Gemba Walk]
spec: APP-FEATURES.md
wireframe: gemba
arch: |
  flowchart LR
    FORM["LocTagFormSheet - category + severity required at pin time"] --> LT["LocTag record via POST /loc-tags"]
    LT --> PORT["Portal Gemba tab - filter and trend by category"]
    LT --> CSV["CSV export for quality reviews"]
    LT -.label set for future defect-detection training.-> ML["Evidence photos + categories = the data flywheel"]
---
Every finding carries a defect category and a severity, chosen at pin time. The
taxonomy is what turns a pile of photos into trendable data — and it is the label set
future defect-detection models will be trained against.
