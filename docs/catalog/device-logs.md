---
id: device-logs
name: Device logs (QA logging)
area: portal
status: shipped
version: 2026.4.46
depends: [data-admin]
terms: [Anchor Portal, SIB]
spec: QA-LOGGING.md
api: |
  POST /logs - batched device log lines, validated and redacted (app · API key)
  GET /logs - query by device, level, module, window, text (portal · admin key)
  GET /logs/devices - devices seen, last activity, QA mode (portal · admin key)
  GET /logs/export.txt - download the filtered window (portal · admin key)
  GET /logs/tail - SSE live tail (portal · admin key)
wireframe: portal
arch: |
  flowchart LR
    APP["iOS AppLog<br/>info/warn/error always · debug in QA Mode<br/>5 s / 50-line batches · errors flush · redaction"] -->|"POST /logs"| S["logging/device-logs.ts<br/>redact again"]
    S --> J[("DATA_DIR/logs/<device>/<day>.jsonl<br/>server.jsonl · LOG_RETENTION_DAYS")]
    J --> P["Portal › Admin › Device Logs<br/>filters · live tail · copy · download"]
---
A work iPhone cannot hand over its console, so the app ships its log lines to
SIB: batched, redacted on both ends (keys, tokens, base64), with a per-device QA
Mode that unlocks debug detail for 24 hours and an abnormal-exit marker on the
next launch. The server keeps JSONL per device per day beside its own console
mirror, prunes by retention, and the portal's Admin → Device Logs page filters,
tails live and exports - reads sit behind the admin gate.
