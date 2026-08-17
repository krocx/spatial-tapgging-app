---
id: ocr-checks
name: OCR / text checks
area: tags
status: shipped
version: baseline
depends: [check-ontology]
terms: [OCR]
spec: APP-FEATURES.md
wireframe: operator
arch: |
  sequenceDiagram
    participant O as Operator (iOS)
    participant V as Vision framework (on-device)
    participant T as Tag.expectedText
    O->>V: Live frame at the language tag
    V-->>O: Recognised text (nothing leaves the device)
    O->>T: Compare against expected value
    alt text unreadable
      O->>O: Fallback to image comparison via POST /perception/validate
    end
    O->>O: PASS / FAIL recorded in the session
---
Language and label checks run on-device Vision text recognition and compare the read
value against the expected one, with image comparison as fallback when text cannot be
read. Nothing leaves the device for recognition.
