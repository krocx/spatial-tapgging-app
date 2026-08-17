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
arch: |
  sequenceDiagram
    participant U as User (iOS quiz UI)
    participant Q as GET /loto/quiz (answers stripped)
    participant G as POST /loto/quiz/submit - gradeQuiz in loto-core.ts
    participant C as Certification store (expiring)
    participant E as POST /loto/events
    U->>Q: Fetch 16-question OSHA bank
    U->>G: Answers
    G-->>U: Score (12/16 to pass) + missed-question review with explanations
    G->>C: Pass -> issue certification with expiry
    U->>E: Later: apply/remove a lock
    E->>C: Valid cert required - expired or missing blocks the event
    Note over C: Portal edits the bank via /loto/quiz/admin - issued certs untouched
---
A seeded 16-question OSHA 1910.147 bank, graded server-side (12/16 to pass), with
missed questions reviewed against the correct answer and explanation — the
explanations are the training. Passing issues an expiring certification that gates
apply and remove; the portal edits the question bank with atomic JSON/CSV import, and
editing never touches certifications already issued.
