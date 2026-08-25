---
id: mes-connector
name: MES connector
area: guides
status: planned
version: baseline
depends: [guide-import]
terms: [MES, Adapter]
spec: PROCEDURE-DESIGNER.md
api: |
  POST /guides/import — the adapter seam a future MES connector plugs into (portal · API key)
arch: |
  flowchart LR
    MES["MES work orders + instructions"] -.planned.-> AD["adapters/instructions-source-adapter.ts"]
    AD --> IMP["POST /guides/import - same path as manual JSON and xlsx"]
    IMP --> ING["guides/ingest.ts"]
    NOTE["Interface is real and stubbed today - vendor integration starts when a target MES is chosen"] -.-> AD
---
The production instruction-source adapter: work orders and instructions flowing in
from the Manufacturing Execution System through the same import path the manual
adapters use today. The interface is real and stubbed; the vendor integration is
deliberately not started until a target MES is chosen.
