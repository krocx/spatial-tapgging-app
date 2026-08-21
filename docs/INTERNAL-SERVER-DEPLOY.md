# SIB Server — Internal Deployment Guide

**Server:** `dca-qa-330.amat.com` · **Port:** `447`

## Prerequisites

- Node.js 18+ installed on the Windows server
- Git installed and access to the Bitbucket repo
- SSL certificate + key files for `dca-qa-330.amat.com` (`.crt` and `.key`)

---

## Step 1 — Clone the repo

```bash
git clone <your-bitbucket-repo-url> C:\sib
cd C:\sib
git checkout feature/loc-tag
```

---

## Step 2 — Create the config file

Create a file called `sib-config.env` **in the root of the repo** (`C:\sib\sib-config.env`):

```env
PORT=447
HOST=0.0.0.0
SSL_CERT_PATH=C:\certs\dca-qa-330.crt
SSL_KEY_PATH=C:\certs\dca-qa-330.key
SIB_DATA_DIR=C:\sib-data
SIB_API_KEY=<choose-a-strong-key>
```

> `SIB_DATA_DIR` is where anchor data, worldmaps, and images are stored.
> Make sure the folder exists and the Node process has write access to it.

The config file is loaded automatically at startup. Real environment variables always
take priority over file values, so existing `SET` / system env vars are never overridden.

---

## Step 3 — Install and build

```bash
cd C:\sib\sib
npm install
npm run build
```

---

## Step 4 — Start the server

```bash
npm start
```

On a successful start you should see:

```
[config] Loading config file: C:\sib\sib-config.env
SIB v0.2 running on 0.0.0.0:447 (HTTPS)
[warmup] Comparator pre-warmed — first inspection will be fast.
```

The web portal is then available at:

```
https://dca-qa-330.amat.com:447/portal
```

---

## Step 5 — Run as a Windows Service (survives reboots)

Download [NSSM](https://nssm.cc/download) and run the following from an **Administrator** command prompt:

```bash
nssm install SIBServer "C:\Program Files\nodejs\node.exe" "C:\sib\sib\dist\index.js"
nssm set SIBServer AppDirectory C:\sib\sib
nssm start SIBServer
```

To check the service is running:

```bash
nssm status SIBServer
```

---

## Updating after a git pull

```bash
cd C:\sib
git pull
cd sib
npm install
npm run build
nssm restart SIBServer
```

> `sib-config.env` is never committed to git, so it survives every pull untouched.

---

## iOS app configuration

In the app's **Settings**, enter:

| Field | Value |
|---|---|
| SIB Server URL | `https://dca-qa-330.amat.com:447` |
| API Key | The `SIB_API_KEY` value from `sib-config.env` |

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `[config] No config file found` | Confirm `sib-config.env` is at `C:\sib\sib-config.env` (repo root, not inside `sib/`) |
| Server starts on HTTP instead of HTTPS | Verify `SSL_CERT_PATH` and `SSL_KEY_PATH` paths are correct and the files are readable |
| `EACCES` / permission error on port 447 | Run NSSM service as a user with permission to bind ports below 1024, or use the Windows port proxy |
| iOS app cannot connect | Confirm the device is on the company network and the firewall allows inbound TCP on port 447 |
| Portal shows "Failed to load anchors" | Check `SIB_API_KEY` matches between the config file and the iOS app Settings |

## Backups & restore

Two admin-gated downloads in the portal (⚙ Settings → 🗄 Backups, requires the
🔒 Admin unlock when `SIB_ADMIN_KEY` is set), or directly:

```
GET /admin/backup?scope=data   # JSON stores only — small; take one weekly
GET /admin/backup?scope=full   # + evidence photos, world maps, 3D models, QR
                               #   images, step images — large; take before upgrades
```

Both stream a `.tar.gz` of the data directory (`SIB_DATA_DIR`, default
`.sib-data`). Requires the system `tar` binary (present on Linux, macOS and
Windows 10 / Server 2019+).

**Restore is deliberately manual** — a restore button on a web page is a
footgun. Procedure:

1. Stop the SIB service (`nssm stop <ServiceName>` / stop the container).
2. Move the current data directory aside (keep it until verified).
3. Unpack the archive into a fresh data directory:
   `mkdir restored && tar -xzf sib-backup-....tar.gz -C restored`
4. Point `SIB_DATA_DIR` at it (or rename it into place).
5. Start the service and verify: `/config` up, portal shows the expected
   anchors/sessions, `/stats` counts look right.

A `data` backup restores stores only — evidence photos, world maps and models
referenced by the restored records must still exist on disk (or restore a
`full` archive). Version note: restore onto the same or newer platform
version; stores are forward-compatible, not backward.
