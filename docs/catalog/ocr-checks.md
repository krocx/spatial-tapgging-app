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
---
Language and label checks run on-device Vision text recognition and compare the read
value against the expected one, with image comparison as fallback when text cannot be
read. Nothing leaves the device for recognition.
