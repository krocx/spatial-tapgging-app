# Migrating SIB from Render to an In-House Server — Checklist

Use this when Render's limits (cold starts, $7/month, no infra-as-code, no real database) actually start getting in the way. This is a checklist, not a tutorial — each item links back to the doc that explains the "why" in more depth.

Read [WHY-RENDER.md](WHY-RENDER.md) first if you haven't, so you know exactly what you're trading away and what you're gaining.

---

## 1. Before you start

- [ ] Confirm *why* you're migrating — cost, cold starts, need for a real DB, need for infra you control? The answer changes what "done" looks like (see §6, Optional upgrades).
- [ ] Decide where this is going to live: a spare machine on-prem, a VPS (Hetzner/DigitalOcean/etc.), or your own datacenter box. This doc assumes "a Linux box you control," not a specific provider.
- [ ] Make sure whoever owns that machine can keep it powered on and network-reachable — this server is now your single point of failure instead of Render's.

## 2. Pull everything off Render first

- [ ] **Export the data disk.** SSH isn't available on Render's dashboard for Starter, so use the Render shell (Dashboard → service → Shell tab) or a temporary debug route to read `/data/.sib-data/` and download it — `anchors/`, `qrimages/`, `worldmaps/`, plus the root-level JSON files (`pass-states.json`, etc., per `JsonFileStore`'s layout).
- [ ] **Copy the exact env vars** currently set in the Render dashboard so nothing gets lost: `SIB_API_KEY`, `SIB_DATA_DIR`, `NODE_ENV`, `PORT`. (There's no `render.yaml` to read these from — they only exist in the dashboard UI, which is exactly the "not infra-as-code" gap called out in WHY-RENDER.md.)
- [ ] **Note the current API key value** — if you rotate it during migration, every device's Settings screen needs updating too.

## 3. Stand up the new server

- [ ] Install Docker (or Node + npm directly, matching whatever `sib/Dockerfile` expects) on the new machine.
- [ ] `git clone` the repo onto the server (or pull via CI).
- [ ] Build the same way Render did: `docker build -f sib/Dockerfile .` from the **repo root**, not from inside `sib/` — the root directory matters because `sib` depends on the `@spatial/shared` workspace package, same constraint Render had.
- [ ] Set the same env vars: `SIB_API_KEY`, `SIB_DATA_DIR` (pick a real path on this machine, e.g. `/srv/sib-data`), `NODE_ENV=production`, `PORT=3001`.
- [ ] Copy the exported `.sib-data/` contents into that `SIB_DATA_DIR` path before first boot, so anchors/tags/pass-states aren't lost.
- [ ] Start the container and confirm `GET /health` responds.

## 4. Networking & TLS

- [ ] Render gave you HTTPS for free — your in-house box won't, by default. Put a reverse proxy in front of the Node process: Caddy (simplest, automatic Let's Encrypt) or nginx + certbot.
- [ ] Point a real domain or subdomain at the server (or at minimum a stable internal hostname/IP) — iOS's App Transport Security will reject plain HTTP except for explicit local-network exceptions, the same constraint that limits local dev to LAN-only HTTP today.
- [ ] Open only the ports you need (443, and 22 for your own SSH access) — Render handled all of this for you; now it's your firewall to configure.
- [ ] Decide if this server needs to be reachable from outside your LAN (remote team members, field inspections off-site) or just internally — that decision drives whether you need port forwarding / a VPN / a public IP at all.

## 5. Cut over the app

- [ ] Update the SIB URL in the iOS app's Settings screen on every device — this is the same field used today to point at a teammate's laptop for local dev, just now pointed at the new server's URL instead of Render's.
- [ ] Verify the API key matches between devices and the new server.
- [ ] Run a full smoke test: scan an anchor QR, enter AR, train a tag, run an inspection, confirm results come back.
- [ ] Once confirmed working, decommission the Render service (or just leave it paused as a fallback for a few days before deleting it).

## 6. Optional upgrades, now that you're not boxed in by Render's plan

These aren't required to migrate, but they're the kind of thing that becomes worth doing once you own the infrastructure rather than renting a Starter-tier service:

- [ ] **Real database.** `CLOUD-MIGRATION-SPEC.md` already has a Postgres schema sketched out (anchors, tags, pass_states, sessions, audit_log, etc.) — worth implementing once flat JSON files start showing scaling pain (today, tag lookup is an unindexed linear scan — see [SIB-TRAINING-FEATURES.md](SIB-TRAINING-FEATURES.md)).
- [ ] **Per-device auth (JWT)** instead of one shared API key — also specified in the cloud-migration spec, not yet built.
- [ ] **Object storage for images** instead of inline base64 in JSON, if data volume grows.
- [ ] **Backups.** Render's persistent disk wasn't being backed up either, so this isn't a regression — but now it's explicitly your job. Cron a nightly `tar` of the data directory off-box at minimum.
- [ ] **Monitoring/alerting** — even something as simple as an uptime check hitting `/health` and paging someone if it fails, since you no longer have Render's own infra reliability backing you.
- [ ] **Auto-deploy on push**, replicating what Render gave you for free — a simple `git pull && docker compose up -d --build` triggered by a webhook or a basic CI runner.

---

## Rollback plan

If something goes wrong mid-migration, Render is still there and still has your data (assuming you didn't delete the disk) — you can revert the iOS Settings URL back to the Render URL and you're running again within minutes. Don't delete the Render service until the in-house server has been stable for at least a few real working days.
