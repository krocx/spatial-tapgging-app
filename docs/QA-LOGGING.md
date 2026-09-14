# QA logging — device logs on the server

**Why.** A work iPhone can't hand over its console. The app ships its log lines
to SIB; you read them in the portal or download a text file. One timeline for
every phone and the server.

## On the phone

- Every `AppLog.info / warn / error` line is queued and POSTed to `/logs` in
  batches (every 5 s or 50 lines). Errors flush immediately. Lines survive a
  bad connection (retried) but not a crash — the next launch sends one
  `previous session ended abnormally` marker instead.
- **QA Mode** (Settings → Diagnostics) adds `debug` lines: material dumps
  when a model loads, object-watchdog deltas, presence poses, every request
  with status and timing. Per device, off by default, auto-off after 24 h,
  orange **QA** badge on every screen while on (tap it to turn off).
- Each device has a short **log id** (Settings → Diagnostics). Share that id
  with whoever reads the logs.
- Redaction on the phone and again on the server: API/admin/IP/AES keys,
  bearer tokens, base64 blobs. Images are never logged.

Modules: `app` `net` `ar` `qr` `cone` `guide` `validation` `model` `object`
`presence`.

## On the server

```
DATA_DIR/logs/YYYY-MM-DD/<deviceId>.jsonl   one file per device per day
DATA_DIR/logs/YYYY-MM-DD/server.jsonl       this process's console
DATA_DIR/logs/devices.json                  last-seen index
```
Rotated by day; `LOG_RETENTION_DAYS` (default 14). Inside the data root, so
the full backup includes it. Never in git.

| Endpoint | Use |
|---|---|
| `POST /logs` | app batches (API-key gated like every write) |
| `GET /logs?device=&since=&until=&level=&module=&q=&limit=` | query (admin gate) |
| `GET /logs/devices` | known devices, newest first |
| `GET /logs/export.txt?…` | plain-text download, same filters |
| `GET /logs/tail?device=&level=` | SSE live stream (`?adminKey=` accepted here only) |

## Reading them

Portal → **Admin → Device Logs**: pick the device, level, module, time
window; search; tick *live tail*; **Copy last 200** or **Download .txt**.
Errors are red, warnings amber, debug grey; 🐞 marks lines sent with QA Mode on.

Typical loop: reproduce on the phone with QA Mode on → open Device Logs, pick
the device, last hour, level *debug +* → download → attach to the ticket.

## Rules

- Never log images, keys, tokens or anchor AES keys (the redactor is a net,
  not a licence).
- Perception internals stay out of `info`; `debug` may carry numbers, never
  format detail.
- Not a system of record — bounded, prunable, for finding bugs only.
