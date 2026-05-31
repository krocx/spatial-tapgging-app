# Render Deployment Guide
**SIB Server — spatial-tagging-app**

This guide takes you from a local codebase to a live SIB server on Render that your team can connect to from their iPhones. It also sets up the GitHub repository in a way that makes a future Bitbucket migration straightforward.

---

## Prerequisites

Before starting, make sure you have:

- [Git](https://git-scm.com/downloads) installed on your Mac (`git --version` to check)
- A [GitHub](https://github.com) account
- A [Render](https://render.com) account (already have one ✓)
- The [GitHub CLI](https://cli.github.com) (optional but speeds things up — `brew install gh`)

---

## Part 1 — Push the Project to GitHub

### 1.1 Create a new GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Fill in:
   - **Repository name:** `spatial-tagging-app`
   - **Visibility:** Private ← keep it private; this repo will contain your API key config
   - **Do NOT** tick "Add a README", "Add .gitignore", or "Choose a license" — the repo must be empty so our first push doesn't conflict
3. Click **Create repository**
4. GitHub will show you a page with a remote URL. Copy the **HTTPS** URL — it looks like:
   ```
   https://github.com/YOUR-USERNAME/spatial-tagging-app.git
   ```

### 1.2 Initialise git in the project folder

Open Terminal, `cd` into the project root, and run these commands one at a time:

```bash
# Navigate to the project (adjust path if yours differs)
cd ~/Claude-Workspace/projects/spatial-tagging-app

# Initialise a git repository with "main" as the default branch.
# Using "main" here is intentional — both GitHub and Bitbucket default to "main",
# so this keeps migration seamless later.
git init -b main

# Stage everything (the .gitignore we just created will automatically exclude
# node_modules, dist/, .sib-data/, secrets, and Xcode artefacts)
git add .

# First commit
git commit -m "Initial commit — Phase 2.5 baseline"
```

### 1.3 Connect to GitHub and push

```bash
# Replace the URL below with the one you copied from GitHub in step 1.1
git remote add origin https://github.com/YOUR-USERNAME/spatial-tagging-app.git

# Push to GitHub
git push -u origin main
```

When prompted, enter your GitHub username and a **Personal Access Token** (PAT) as the password — GitHub no longer accepts your account password over HTTPS. If you don't have a PAT:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it a name (e.g. `spatial-tagging-deploy`), tick **repo** scope, and click **Generate token**
4. Copy the token — you only see it once. Paste it as the password in Terminal.

> **Tip:** To avoid re-entering credentials every push, run `git config --global credential.helper osxkeychain` — macOS will remember the token in Keychain after the first successful push.

After the push, reload your GitHub repo page — you should see all the project files.

---

## Part 2 — Deploy the SIB Server on Render

Render reads our `Dockerfile` from the repo and builds + runs the container automatically.

### 2.1 Create a new Web Service

1. Log in to [dashboard.render.com](https://dashboard.render.com)
2. Click **+ New** → **Web Service**
3. On the "Create a new Web Service" page, choose **Build and deploy from a Git repository** → click **Next**
4. Click **Connect GitHub** if you haven't already, and grant Render access to your `spatial-tagging-app` repo
5. Select the `spatial-tagging-app` repo from the list → click **Connect**

### 2.2 Configure the Web Service

Fill in the form exactly as follows:

| Field | Value |
|---|---|
| **Name** | `sib-server` (or any name you like) |
| **Region** | Choose the one closest to your team |
| **Branch** | `main` |
| **Root Directory** | `sib` |
| **Runtime** | **Docker** ← Render auto-detects our `Dockerfile` |
| **Instance Type** | **Starter** ($7/month) is fine for dev/testing |

Leave everything else at its default. Scroll down to the **Environment Variables** section — do NOT click Deploy yet.

### 2.3 Add environment variables

Click **Add Environment Variable** for each of the following:

| Key | Value | Notes |
|---|---|---|
| `SIB_API_KEY` | A long random string you choose (e.g. 32+ characters) | This is the secret your iOS app sends in `X-API-Key`. Write it down — you'll enter it in the app's Settings screen. Example: `sk-sib-a8f3d2e1b4c7f9a0d3e6b2c5f8a1d4e7` |
| `SIB_DATA_DIR` | `/data/.sib-data` | Tells SIB where to persist anchor + tag data on the Render disk |
| `NODE_ENV` | `production` | Enables production optimisations |
| `PORT` | `3001` | Must match what the Dockerfile exposes |

> **Security note:** These values are stored securely by Render and are never visible in your git repo.

### 2.4 Add a Persistent Disk

Without a disk, Render's filesystem resets on every deploy — you'd lose all your anchors and tags. The disk keeps your data safe across deploys and restarts.

1. Still on the Web Service creation page, scroll down to the **Disks** section
2. Click **Add Disk**
3. Fill in:
   - **Name:** `sib-data`
   - **Mount Path:** `/data`
   - **Size:** `1 GB` (more than enough for Phase 2.5)
4. Click **Add**

### 2.5 Deploy

Scroll to the bottom and click **Create Web Service**.

Render will:
1. Pull your code from GitHub
2. Build the Docker image (the multi-stage build compiles TypeScript → `dist/`)
3. Start the container and run the health check at `/health`

This takes about 2–4 minutes on first deploy. You'll see the build logs streaming in real time. When you see **"Your service is live"** and the status dot turns green, the server is running.

### 2.6 Note your server URL

At the top of the service page you'll see a URL like:

```
https://sib-server.onrender.com
```

Copy this — every team member needs to enter it in the iOS app Settings screen.

---

## Part 3 — Connect the iOS App

Each person on the team does this on their own iPhone:

1. Open the **SpatialTagging** app
2. Tap the **gear icon** (Settings)
3. Set **SIB Server URL** to your Render URL:
   ```
   https://sib-server.onrender.com
   ```
   (no trailing slash)
4. Set **API Key** to the `SIB_API_KEY` value you chose in step 2.3
5. Tap **Save**, then tap **Test Connection** — you should see a green "Connected" banner

> **Note:** On Render's free/starter tier, the server may "spin down" after 15 minutes of inactivity and take ~30 seconds to wake up on the next request. The Test Connection button will wake it if needed. This is normal on the Starter plan.

---

## Part 4 — Verify the Deployment

From Terminal (or any HTTP client), run a quick smoke test to confirm the server is live and auth is working:

```bash
# Replace with your actual URL and API key
curl https://sib-server.onrender.com/health
# Expected: {"status":"ok","timestamp":"..."}

curl -H "X-API-Key: YOUR_API_KEY" https://sib-server.onrender.com/anchors
# Expected: [] (empty array — no anchors yet)

# Without the API key — should be rejected
curl https://sib-server.onrender.com/anchors
# Expected: 401 Unauthorized
```

---

## Part 5 — Day-to-Day: Pushing Updates

Whenever you make changes to the SIB server code and want to deploy them:

```bash
cd ~/Claude-Workspace/projects/spatial-tagging-app

git add .
git commit -m "describe what changed"
git push
```

Render watches the `main` branch and automatically triggers a new build + deploy within about a minute of each push. Zero downtime — the old container keeps serving requests until the new one passes its health check.

---

## Part 6 — Future Bitbucket Migration

The repo is already set up to migrate cleanly. When the time comes:

### 6.1 Create a Bitbucket repo

1. Go to [bitbucket.org](https://bitbucket.org) → **Create repository**
2. Name it `spatial-tagging-app`, set to **Private**
3. Do **not** initialise with a README
4. Copy the HTTPS clone URL: `https://bitbucket.org/YOUR-WORKSPACE/spatial-tagging-app.git`

### 6.2 Add Bitbucket as a second remote

```bash
cd ~/Claude-Workspace/projects/spatial-tagging-app

# Add Bitbucket alongside GitHub (don't remove GitHub yet)
git remote add bitbucket https://bitbucket.org/YOUR-WORKSPACE/spatial-tagging-app.git

# Push your full history to Bitbucket
git push bitbucket main
```

### 6.3 Switch Render to Bitbucket

1. In Render dashboard → your `sib-server` service → **Settings** → **Build & Deploy**
2. Click **Disconnect** next to the GitHub repo
3. Click **Connect** → choose Bitbucket → authorise → select the migrated repo
4. Save — future pushes to Bitbucket will now trigger deploys

### 6.4 Remove GitHub remote (when ready)

```bash
git remote remove origin
git remote rename bitbucket origin
```

From this point, `git push` goes to Bitbucket. All history, branches, and tags carry over intact because we always used standard Git — no GitHub-specific features.

---

## Quick Reference

| What | Where |
|---|---|
| Render dashboard | [dashboard.render.com](https://dashboard.render.com) |
| Build logs | Render dashboard → sib-server → **Logs** tab |
| Environment variables | Render dashboard → sib-server → **Environment** tab |
| Server URL | Shown at the top of the Render service page |
| Health check | `GET https://your-url.onrender.com/health` |
| SIB API key | Set in iOS app Settings → API Key field |
| Push a new deploy | `git add . && git commit -m "..." && git push` |

---

## Troubleshooting

**Build fails with "Cannot find module"**
The TypeScript compile step failed. Check the build logs for the exact error. Usually a missing import or a type error introduced in the last change.

**Health check fails / service stays "In Progress"**
The container started but the `/health` endpoint isn't responding. Check that `PORT=3001` is set in Environment variables and the Dockerfile `EXPOSE 3001` matches.

**iOS app gets 401 Unauthorized**
The API key in the app's Settings doesn't match `SIB_API_KEY` in Render. Re-check both — they must be character-for-character identical (no trailing spaces).

**Data disappears after a deploy**
The Persistent Disk is not attached, or `SIB_DATA_DIR` isn't set to `/data/.sib-data`. Verify both in the Render dashboard.

**"Service unavailable" on first request after inactivity**
Normal on Starter plan — the server spun down. Wait 20–30 seconds and retry.
