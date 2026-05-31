# Xcode Project Setup — Phase 2A
### Spatial Tagging App · iOS Native (Swift + ARKit)

---

## Prerequisites

- Xcode 15 or later
- iPhone running iOS 16+ (ARKit world tracking requires a physical device — the Simulator does not support ARKit)
- Macbook running SIB (`npm run dev` in `sib/`)
- Both on the same WiFi network

---

## Step 1 — Create the Xcode Project

1. Open Xcode → **File → New → Project**
2. Choose **iOS → App**
3. Fill in:
   - **Product Name:** `SpatialTaggingApp`
   - **Team:** (your Apple ID / developer account)
   - **Organization Identifier:** `com.yourname` (or `com.spatial`)
   - **Bundle Identifier:** `com.yourname.SpatialTaggingApp`
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None
4. **Uncheck** "Include Tests" for now
5. Save into: `projects/spatial-tagging-app/ios-app/`

---

## Step 2 — Add Source Files

Delete the auto-generated `ContentView.swift` that Xcode creates. Then add all files from `SpatialTaggingApp/`:

In Xcode's Project Navigator, right-click the `SpatialTaggingApp` group → **Add Files to "SpatialTaggingApp"**.

Add these files (maintaining the folder structure as groups):

```
SpatialTaggingApp/
├── App/
│   ├── SpatialTaggingApp.swift    ← replaces auto-generated @main
│   ├── ContentView.swift
│   └── AppSettings.swift
├── Models/
│   ├── SIBTypes.swift
│   └── AppState.swift
├── Services/
│   ├── SIBClient.swift
│   ├── QRScannerService.swift
│   └── ARSessionManager.swift
├── Modes/
│   ├── AnchorScanView.swift
│   ├── ModeSelectionView.swift
│   └── SettingsView.swift
└── Components/
    ├── ARContainerView.swift
    └── ScanStatusBanner.swift
```

> **Tip:** When adding, check **"Create groups"** (not folder references) and ensure all files are added to the `SpatialTaggingApp` target.

---

## Step 3 — Replace Info.plist

Xcode 15+ generates Info.plist entries in the project settings instead of a file. You have two options:

### Option A — Use the provided Info.plist file (recommended)

1. In your project's Build Settings → Info.plist File, set the path to `SpatialTaggingApp/Resources/Info.plist`
2. Copy `Resources/Info.plist` into your Xcode project

### Option B — Add keys manually in Xcode UI

In your Target → **Info** tab, add these keys:

| Key | Type | Value |
|---|---|---|
| NSCameraUsageDescription | String | `The camera is required for AR spatial tagging and QR code scanning.` |
| NSMicrophoneUsageDescription | String | `Microphone access may be requested by ARKit. No audio is recorded.` |
| UIRequiredDeviceCapabilities | Array | Add item: `arkit` |
| NSAppTransportSecurity / NSAllowsLocalNetworking | Boolean | YES |
| NSAppTransportSecurity / NSAllowsArbitraryLoads | Boolean | YES *(dev only)* |

---

## Step 4 — Enable Capabilities

In your Target → **Signing & Capabilities** tab:

1. Click **+ Capability**
2. Add **Camera** — this appears as `NSCameraUsageDescription` in Info.plist
3. Add **ARKit** (or just ensure UIRequiredDeviceCapabilities includes `arkit`)

> ARKit does **not** need a special entitlement — it is enabled by the Info.plist `UIRequiredDeviceCapabilities` entry and by importing ARKit in code.

---

## Step 5 — Deployment Target

In your Target → **General** tab:

- Set **Minimum Deployments** to **iOS 16.0**

This is required for:
- `symbolEffect` (SwiftUI animations — iOS 17 note: if your device is iOS 16, remove `.symbolEffect(.pulse)` from `ScanStatusBanner.swift`)
- `ARWorldTrackingConfiguration` full feature set

> **iOS 17+ recommended** for `symbolEffect`. If targeting iOS 16, remove `.symbolEffect(.pulse)` from `ScanStatusBanner.swift` line 43.

---

## Step 6 — Delete the Auto-Generated Entry Point

Xcode generates a default `SpatialTaggingApp.swift` with `@main`. Since our file provides `@main`:

1. Delete the Xcode-generated `SpatialTaggingApp.swift` (it will conflict)
2. Our version in `App/SpatialTaggingApp.swift` is the entry point

---

## Step 7 — Run on Device

**ARKit requires a physical iPhone** — the Simulator will not work.

1. Connect your iPhone via USB
2. Trust the development certificate on the iPhone
3. Select your iPhone as the run target
4. Press **⌘R**

On first launch:
- The app will request Camera permission — tap **Allow**
- You'll see the Mode Selection screen with a red "SIB not configured" dot

---

## Step 8 — Configure SIB Connection

### On the Macbook:

```bash
cd projects/spatial-tagging-app/sib
npm run dev
```

The console now prints your LAN IP addresses:

```
SIB v0.2 running on 0.0.0.0:3001
📱 iPhone SIB URL candidates:
   http://192.168.1.42:3001
```

### On the iPhone:

1. Tap the ⚙️ gear icon → Settings
2. Enter the SIB URL shown in the console (e.g., `http://192.168.1.42:3001`)
3. Enter an Asset ID (e.g., `eq-001`)
4. Tap **Test Connection** → should show ✓ Connected
5. Tap **Save**

---

## Step 9 — Test QR Scanning

### Generate a test QR code:

The QR must encode a JSON payload in this exact format:

```json
{"assetId":"eq-001","anchorId":"panel-a"}
```

Generate and print using any QR generator (e.g., qr-code-generator.com or `qrencode` in Terminal):

```bash
# Install qrencode if needed: brew install qrencode
qrencode -o test-qr.png -s 10 '{"assetId":"eq-001","anchorId":"panel-a"}'
open test-qr.png
```

Print the QR at ~10cm × 10cm. You can also just hold it up on another screen for testing.

### In the app:

1. Tap **Author Mode**
2. Point camera at QR code
3. Banner transitions: **Scanning → Detected → Locked ✓**
4. Bottom card shows the anchor ID and tag count (0 on first visit)
5. SIB auto-creates the anchor on first scan
6. Tap **Continue to Author Mode** → shows Phase 2A placeholder

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "SIB Unreachable" | Check Macbook and iPhone are on same WiFi. Verify the IP with `ifconfig` on Mac. Try `curl http://<ip>:3001/anchors` from iPhone Safari. |
| Camera permission denied | Go to iPhone Settings → Privacy → Camera → enable for SpatialTaggingApp |
| Build error: `@MainActor` isolation | Ensure Xcode 15 / Swift 5.9+. Clean build folder (⌘⇧K) and rebuild. |
| QR never detected | Ensure QR payload is valid JSON with `assetId` and `anchorId` keys. Test in well-lit conditions. |
| `symbolEffect` compile error | Change minimum deployment to iOS 17, or remove `.symbolEffect(.pulse)` from `ScanStatusBanner.swift` |
| ARAnchor not placed | The raycast needs feature points. Move camera around to help ARKit map the environment before scanning QR. |

---

## What Phase 2A Gives You

After setup, you can:

✅ Scan any compliant QR code and have the anchor created in SIB automatically  
✅ See the stable 3-state scan flow (Scanning → Detected → Locked)  
✅ Confirm SIB connectivity from the phone  
✅ See how many tags exist at each anchor (ready for Phase 2B author flow)  
✅ Enter placeholder Author/Operator views (to be replaced in Phase 2B/2C)  

**Next: Phase 2B** — Tag creation + honeycomb pass-state capture within the Author mode view.
