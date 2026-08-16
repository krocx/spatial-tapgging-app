---
id: loto-training
name: LOTO training + certification
area: iloto
status: shipped
version: 2026.4.42
depends: [loto-event-log]
terms: [LOTO, Certification]
spec: ILOTO.md
wireframe: iloto
---
A seeded 16-question OSHA 1910.147 bank, graded server-side (12/16 to pass), with
missed questions reviewed against the correct answer and explanation — the
explanations are the training. Passing issues an expiring certification that gates
apply and remove; the portal edits the question bank with atomic JSON/CSV import, and
editing never touches certifications already issued.
