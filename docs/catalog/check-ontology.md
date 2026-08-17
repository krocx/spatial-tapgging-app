---
id: check-ontology
name: Typed check ontology
area: tags
status: shipped
version: baseline
depends: [qr-anchoring]
terms: [Tag, Ontology]
spec: APP-FEATURES.md
wireframe: author
arch: |
  flowchart LR
    T["Tag.tagType: presence / language / routing / configuration / part"] --> CAP["Drives capture guidance in Author mode"]
    T --> ROUTE{"Scoring path"}
    ROUTE -->|language| OCR["On-device Vision OCR vs expected value"]
    ROUTE -->|others| IMG["POST /perception/validate - image comparison"]
    T --> REP["Portal reporting groups by type"]
---
Every tag is typed by what it checks: presence, language, routing, configuration, or
part. The type drives capture guidance, scoring behaviour and portal reporting — a
language check runs OCR, a presence check runs image comparison.
