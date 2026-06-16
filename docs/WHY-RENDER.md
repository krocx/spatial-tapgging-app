# Why Render, and What We Can (and Can't) Do With It

## Why we picked it

The SIB server needed to be reachable by every team member's iPhone, not just whoever's laptop happened to be running `npm run dev` on the same WiFi. Render was the fastest way to get a single, stable, always-reachable HTTPS URL without standing up real infrastructure:

- **Deploys straight from the Dockerfile we already had** (`sib/Dockerfile`) — no rewriting the app to fit a platform's opinions.
- **Auto-deploys on every push to `main`** — push, wait about a minute, it's live. No manual build/deploy steps.
- **Free HTTPS out of the box** — no certificates to manage.
- **A persistent disk option** — so the flat-JSON data store (`.sib-data/`) survives restarts and redeploys instead of resetting every time, without us having to stand up a real database yet.
- **Cheap to start** — the Starter plan is $7/month, which is the right amount of commitment for a project still in active development with a small team.
- **Zero ops overhead** — no server patching, no firewall rules, no SSH key management, nothing to keep awake.

In short: it was the option that let us stop thinking about infrastructure and keep working on the app.

## What we can actually do with it today

- Push to `main` and have the live server update itself within about a minute, zero-downtime.
- Give every teammate one URL that always resolves, regardless of whose machine is open or asleep.
- Store anchors, tags, pass-states, world maps, and QR images on the mounted persistent disk (`/data`, 1GB) so none of that is lost between deploys.
- Get HTTPS automatically, no cert wrangling.
- Check `GET /health` for a quick uptime/liveness probe (Render also uses this internally for its own health checks).

## What it doesn't do (yet, on Starter)

- **It doesn't stay warm.** After about 15 minutes with no requests, the Starter tier spins the service down. The next request after that pays a cold-start penalty — roughly 30 seconds before it responds. This is expected behavior on this plan, not a bug, but it's worth knowing before a live demo: hit `/health` a minute beforehand to warm it up.
- **It doesn't scale out.** One instance, no auto-scaling, no load balancing. Fine for a small team hitting it occasionally; not fine if this ever needs to serve many concurrent inspection sessions.
- **It isn't a database.** The persistent disk just makes the same flat-JSON files durable — it doesn't give us transactions, indexing, or query capability. We're trading "a teammate's laptop might be asleep" for "still flat files, just always reachable."
- **It isn't infrastructure-as-code.** There's no `render.yaml` in the repo — the service is configured by hand in Render's dashboard (env vars, disk mount, build settings). That means the deployment configuration itself isn't version-controlled or reproducible from a fresh `git clone` alone; someone has to remember (or document, which is what this doc and [RENDER-DEPLOYMENT.md](RENDER-DEPLOYMENT.md) are for) how the dashboard was set up.
- **It doesn't monitor itself.** No metrics dashboard, no alerting, no log aggregation beyond what Render's basic log viewer shows.

## Render vs. a local/in-house server

| | **Local (a teammate's machine)** | **Render (Starter, current)** | **In-house server (future)** |
|---|---|---|---|
| Reachability | Only while that machine is awake and on the same WiFi | Always reachable, but cold-starts after 15 min idle | Always reachable, no cold start |
| Cost | Free | $7/month | Hardware/hosting cost, but no per-platform markup |
| Setup effort | `npm install && npm run dev` | One-time dashboard config | Real ops work: provisioning, TLS, process management, backups |
| HTTPS | No (LAN-only HTTP) | Yes, automatic | Manual (reverse proxy + cert, e.g. Caddy/nginx + Let's Encrypt) |
| Data persistence | Local disk, git-ignored folder | Persistent disk (1GB), same flat-JSON format | Whatever disk/DB you choose — full control |
| Auth | Off by default (no `SIB_API_KEY` set) | Required, must configure | Your choice entirely |
| Deploys | Manual, on that machine | Git push → auto build/deploy | Depends entirely on what you set up (CI/CD, manual, etc.) |
| Scaling | None | None (single instance) | Whatever you build for it |
| Who can break it | Whoever's laptop it is | Render's infra (rare) + our own bad deploys | Us, entirely — for better and worse |
| Ops burden on us | None, but fragile | Near-zero | All of it |

The honest summary: Render is the right tool for *right now* — a small team, an app still under active development, and a need for "it just works" over "it's fully ours." An in-house server becomes worth the extra ops burden once cold starts, the $7/month, the lack of infrastructure-as-code, or the lack of a real database start actually limiting the work — not before. See [RENDER-TO-INHOUSE-MIGRATION.md](RENDER-TO-INHOUSE-MIGRATION.md) for the checklist to make that move when the time comes.
