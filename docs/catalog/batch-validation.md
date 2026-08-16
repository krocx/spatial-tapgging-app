---
id: batch-validation
name: Batch validation
area: tags
status: shipped
version: baseline
depends: [patch-scoring]
terms: [Batch Validation, Anchor]
spec: SERVER-REFERENCE.md
wireframe: operator
---
One scan, every answer: a single anchor capture validates all tags on that anchor and
returns per-tag verdicts in one pass. This is what makes a five-minute inspection a
thirty-second one.
