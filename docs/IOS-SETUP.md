# iOS App Setup Guide

Full onboarding guide for building and running the SpatialTaggingApp iOS app from a fresh clone. This supersedes the old `ios-app/XCODE-SETUP.md`, which described creating the Xcode project from scratch — that step is no longer needed since the project already exists in the repo.

---

## Prerequisites

- A Mac running macOS 13+ with **Xcode 15+** installed (Xcode 16+ recommended)
- An iPhone running **iOS 16+** (ARKit is required — the iOS Simulator cannot run AR features, so you need a physical device)
- A free **Apple ID** — no paid Apple Developer Program membership is required for personal-device testing
- A Lightning/USB-C cable to connect your iPhone to your Mac
- The SIB server URL and API key for the team's deployment (ask whoever ran the [Render deployment](RENDER-DEPLOYMENT.md) — typically `https://sib-server-hiul.onrender.com` plus a shared API key)

---

## 1. Clone the repository

```bash
git clone https://bitbucket.org/<your-workspace>/spatial-tagging-app.git
cd spatial-tagging-app
```

Replace `<your-workspace>` with the team's actual Bitbucket workspace name. You'll get the exact URL from whoever owns the repo.

> The iOS app source lives entirely inside this repo at `ios-app/SpatialTaggingApp/` — there's no separate submodule or second clone step.

---

## 2. Open the project in Xcode

```bash
open ios-app/SpatialTaggingApp/SpatialTaggingApp.xcodeproj
```

Or double-click the `.xcodeproj` file in Finder.

---

## 3. Set your own signing team

The project ships configured with the original developer's Apple Team ID. Each team member must switch this to their own, or the build will fail with a provisioning error.

1. In the Project Navigator (left sidebar), select the top-level **SpatialTaggingApp** project
2. Select the **SpatialTaggingApp** target
3. Open the **Signing & Capabilities** tab
4. Under **Team**, choose your own Apple ID from the dropdown (sign in via **Xcode → Settings → Accounts** first if it's not listed)
5. Leave **Automatically manage signing** checked — Xcode will provision a free personal certificate
6. Repeat for the `SpatialTaggingAppTests` and `SpatialTaggingAppUITests` targets if you plan to run tests (not required just to run the app)

> You do **not** need to change the Bundle Identifier (`com.krocx.SpatialTaggingApp`). Automatic signing scopes the provisioning profile to your account even when multiple developers share the same bundle ID for personal/local builds — Xcode will prompt you if a conflict ever does arise.

---

## 4. Connect your iPhone and build

1. Plug your iPhone into your Mac via cable
2. On the iPhone, tap **Trust This Computer** if prompted
3. In Xcode's toolbar, select your iPhone from the device/scheme picker (next to the Run button)
4. Press **⌘R** or click the Run (▶) button
5. **First run only:** the app will fail to launch on-device with an "Untrusted Developer" prompt. On the iPhone go to **Settings → General → VPN & Device Management**, tap your developer certificate (your Apple ID email), and tap **Trust**
6. Run again (**⌘R**) — the app should now launch

---

## 5. Grant permissions on first launch

The app will ask for:
- **Camera access** — required for AR; tap **Allow**

No other permissions are needed.

---

## 6. Point the app at the SIB server

Every device configures its own connection independently — there's no shared config file.

1. In the app, tap the **gear icon** on the home screen (Settings)
2. Enter the **SIB Server URL** given to you by your team (e.g. `https://sib-server-hiul.onrender.com`, no trailing slash)
3. Enter the **API Key** given to you by your team
4. Tap **Save**, then **Test Connection** — you should see a green "Connected" banner

> If the server is on Render's free/starter tier it may take ~20–30 seconds to wake up after being idle. Test Connection will wake it — just retry once if the first attempt times out.

---

## 7. You're ready

From the home screen you can now enter **Author Mode** (to create and train inspection tags) or **Operator Mode** (to run inspections against tags someone else trained). See [APP-FLOW.md](APP-FLOW.md) for a full walkthrough of both, including an interactive wireframe.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **"No signing certificate" / provisioning error** | Re-check step 3 — make sure your own Apple ID is selected as the Team, not the original developer's. |
| **"Untrusted Developer" on iPhone, app won't open** | Settings → General → VPN & Device Management → trust your certificate (step 4.5). |
| **Build succeeds but app crashes immediately on launch** | Usually a missing camera permission — check Settings → SpatialTaggingApp → Camera is enabled on the iPhone. |
| **App launches but AR view is black/frozen** | ARKit needs a well-lit room with visible texture/features — point the camera at a textured surface (not a blank wall) and move slowly. |
| **"Connection failed" in Settings** | Double-check the URL has no typo and no trailing slash, and the API key matches exactly (no extra spaces). If on Render's free tier, retry after ~30 seconds. |
| **QR scan doesn't lock the anchor** | Make sure you're scanning the *printed/shared* QR for that specific anchor — `QRScanGateView` rejects QR codes belonging to a different anchor and shows an error banner for a few seconds before letting you retry. |
| **Xcode shows "Cannot find module" / build errors on first open** | Run **Product → Clean Build Folder** (⇧⌘K), then build again — this clears stale derived data from a previous clone. |
